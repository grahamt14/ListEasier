import base64
import json
import os
import boto3
import time
import random
import threading
from openai import OpenAI
from concurrent.futures import ThreadPoolExecutor

# AWS clients
secretsManager = boto3.client('secretsmanager')
dynamodb = boto3.resource('dynamodb')

# Cache for credentials
cachedCredentials = None
cacheExpiry = 0

def get_openai_api_key():
    """Get OpenAI API key from AWS Secrets Manager"""
    global cachedCredentials, cacheExpiry
    
    # Check cache first
    if cachedCredentials and time.time() < cacheExpiry:
        return cachedCredentials
    
    try:
        secret_name = os.environ.get('OPENAI_SECRET_NAME', 'openai-api-key')
        
        print(f"Retrieving OpenAI API key from Secrets Manager: {secret_name}")
        response = secretsManager.get_secret_value(SecretId=secret_name)
        
        # Parse the secret
        secret_data = json.loads(response['SecretString'])
        
        # Get the API key - handle different possible key names
        api_key = secret_data.get('apiKey') or secret_data.get('api_key') or secret_data.get('OPENAI_API_KEY')
        
        if not api_key:
            raise ValueError("OpenAI API key not found in secret")
        
        # Cache for 5 minutes
        cachedCredentials = api_key
        cacheExpiry = time.time() + (5 * 60)
        
        return api_key
        
    except Exception as e:
        print(f"Error retrieving OpenAI API key from Secrets Manager: {e}")
        # Fall back to environment variable if Secrets Manager fails
        env_key = os.environ.get('OPENAI_API_KEY')
        if env_key:
            print("Falling back to environment variable for OpenAI API key")
            return env_key
        raise Exception("Failed to retrieve OpenAI API key")

class TokenBucket:
    def __init__(self, tpm_limit=180000):
        self.tpm_limit = tpm_limit
        self.tokens_used = 0
        self.last_refill_time = time.time()
        self.lock = threading.Lock()
    
    def consume(self, tokens):
        with self.lock:
            current_time = time.time()
            elapsed_minutes = (current_time - self.last_refill_time) / 60
            
            if elapsed_minutes >= 1:
                self.tokens_used = 0
                self.last_refill_time = current_time
            elif elapsed_minutes > 0:
                tokens_to_refill = min(self.tokens_used, int(self.tpm_limit * elapsed_minutes))
                self.tokens_used -= tokens_to_refill
                self.last_refill_time = current_time
            
            if self.tokens_used + tokens > self.tpm_limit:
                wait_time = max(60 - (current_time - self.last_refill_time), 0)
                return False, wait_time
            
            self.tokens_used += tokens
            return True, 0

def lambda_handler(event, context):
    """Main Lambda handler with secure API key management"""
    category = event.get('category')
    subCategory = event.get('subCategory')
    SelectedCategoryOptions = event.get('SelectedCategoryOptions', {})
    base64_image_groups = event.get('Base64Key', [])
    
    # Extract AI category fields resolution settings
    ai_resolve_fields = SelectedCategoryOptions.pop('_aiResolveCategoryFields', False)
    category_fields = SelectedCategoryOptions.pop('_categoryFields', [])
    
    # Batch configuration
    BATCH_SIZE = int(os.environ.get('BATCH_SIZE', '1'))
    USE_BATCHING = os.environ.get('USE_BATCHING', 'false').lower() == 'true'
    
    if not category or not subCategory:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'Missing category or subcategory'})
        }
    
    prompt = get_prompt_from_dynamodb(category, subCategory)
    if 'error' in prompt:
        return {
            'statusCode': prompt.get('statusCode', 500),
            'body': json.dumps(prompt)
        }
    
    # Get API key from Secrets Manager
    try:
        api_key = get_openai_api_key()
    except Exception as e:
        print(f"Failed to get OpenAI API key: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Failed to retrieve API credentials'})
        }
    
    client = OpenAI(api_key=api_key)
    token_bucket = TokenBucket()
    
    # Debug logging
    print(f"Processing {len(base64_image_groups)} image groups")
    print(f"AI resolve fields: {ai_resolve_fields}")
    print(f"Category fields count: {len(category_fields)}")
    print(f"USE_BATCHING: {USE_BATCHING}, BATCH_SIZE: {BATCH_SIZE}")
    
    # Build enhanced prompt if AI field resolution is enabled
    enhanced_prompt = prompt
    if ai_resolve_fields and category_fields:
        enhanced_prompt = build_enhanced_prompt_with_category_fields(prompt, category_fields, SelectedCategoryOptions)
        print(f"Enhanced prompt built with {len(category_fields)} category fields")
    
    # Intelligent batching - but disabled by default for now
    if USE_BATCHING and len(base64_image_groups) > 1 and len(base64_image_groups) <= BATCH_SIZE:
        print("Using batch processing")
        return process_batched_groups(client, token_bucket, base64_image_groups, enhanced_prompt, SelectedCategoryOptions, BATCH_SIZE, ai_resolve_fields)
    else:
        # Original single-group processing (this should work)
        print("Using individual processing")
        return process_individual_groups(client, token_bucket, base64_image_groups, enhanced_prompt, SelectedCategoryOptions, ai_resolve_fields)

def build_enhanced_prompt_with_category_fields(base_prompt, category_fields, field_selections):
    """Build enhanced prompt that includes category fields resolution instructions"""
    
    # Filter out fields that already have user-provided values
    empty_fields = []
    for field in category_fields:
        field_label = field.get('FieldLabel', '')
        current_value = field_selections.get(field_label, '')
        
        # Consider field empty if it's not set, empty string, or default value
        if not current_value or current_value == "-- Select --" or current_value.strip() == "":
            empty_fields.append(field)
    
    if not empty_fields:
        print("No empty category fields to resolve")
        return base_prompt
    
    # Build the enhanced prompt
    enhanced_prompt = base_prompt + "\n\n"
    enhanced_prompt += "ADDITIONAL TASK: Based on the images and any existing information, please attempt to determine appropriate values for the following category fields that the user has not filled in:\n\n"
    
    for field in empty_fields:
        field_label = field.get('FieldLabel', '')
        category_options = field.get('CategoryOptions', '')
        
        enhanced_prompt += f"**{field_label}**:\n"
        
        if category_options and category_options.strip():
            options = [opt.strip() for opt in category_options.split(';') if opt.strip()]
            if len(options) > 0 and len(options) <= 20:
                enhanced_prompt += f"- Choose from: {', '.join(options)}\n"
            elif len(options) > 20:
                enhanced_prompt += f"- Choose from available options (there are {len(options)} total options)\n"
                enhanced_prompt += f"- Some examples: {', '.join(options[:10])}\n"
        else:
            enhanced_prompt += f"- Provide an appropriate value\n"
        
        enhanced_prompt += f"- If you cannot determine a value from the images, use 'Unknown' or 'Not Specified'\n\n"
    
    enhanced_prompt += """IMPORTANT: Please include these determined values in your JSON response under a new field called 'aiResolvedFields'. 
The structure should be:
{
    "title": "your title here",
    "description": "your description here",
    "aiResolvedFields": {
        "FieldLabel1": "determined value",
        "FieldLabel2": "determined value"
    }
}

Only include fields in aiResolvedFields that you can reasonably determine from the images. If you cannot determine a value with confidence, omit that field entirely from aiResolvedFields.\n\n"""
    
    print(f"Enhanced prompt with {len(empty_fields)} fields to resolve")
    return enhanced_prompt

def process_individual_groups(client, token_bucket, image_groups, prompt, selected_options, ai_resolve_fields):
    """Enhanced individual processing with AI field resolution support"""
    all_results = []
    
    for i, image_group in enumerate(image_groups):
        print(f"Processing image group {i+1}/{len(image_groups)}")
        
        estimated_tokens = estimate_tokens(image_group, prompt, selected_options)
        can_proceed, wait_time = token_bucket.consume(estimated_tokens)
        
        if not can_proceed:
            print(f"Rate limit hit, waiting {wait_time} seconds")
            time.sleep(wait_time + 0.1)
        
        result = process_image_group_with_retry(client, image_group, prompt, selected_options, ai_resolve_fields)
        
        # Enhanced result logging
        if isinstance(result, dict):
            print(f"Result for group {i+1}: {result.get('title', 'No title')[:50]}")
            if ai_resolve_fields and 'aiResolvedFields' in result:
                print(f"AI resolved fields: {list(result['aiResolvedFields'].keys())}")
        else:
            print(f"Result for group {i+1}: {str(result)[:50]}")
        
        all_results.append(result)
    
    print(f"Completed processing {len(all_results)} groups")
    return {
        'statusCode': 200,
        'body': json.dumps(all_results)
    }

def process_image_group_with_retry(client, image_group, prompt, selected_options, ai_resolve_fields, max_retries=3):
    """Process a single image group with enhanced error handling and AI field resolution"""
    
    # Build the prompt with selected options (matching your original logic)
    if selected_options:
        # Convert dict to formatted JSON string
        options_str = json.dumps(selected_options, indent=2)
        enhanced_prompt = f"{prompt}\n\nGain additional context on the images based on the following user selected options which describe the images:\n{options_str}"
    else:
        enhanced_prompt = prompt
    
    # Build content array for the API call
    content = [{"type": "text", "text": enhanced_prompt}]
    
    # Add each image from the group
    for image_base64 in image_group:
        content.append({
            "type": "image_url",
            "image_url": {
                "url": image_base64,
                "detail": "low"
            }
        })
    
    retries = 0
    while retries <= max_retries:
        try:
            print(f"Making OpenAI API call (attempt {retries + 1}/{max_retries + 1})")
            
            completion = client.chat.completions.create(
                model="gpt-4o-mini-2024-07-18",
                messages=[{
                    "role": "user",
                    "content": content
                }],
                max_tokens=1000 if ai_resolve_fields else 800,  # More tokens if AI fields resolution
                temperature=0.7
            )
            
            response_content = completion.choices[0].message.content
            print(f"Received response: {response_content[:100]}...")
            
            # Clean and parse the response
            try:
                # First, clean the response to remove markdown formatting
                cleaned_response = response_content.strip()
                
                # Remove markdown code blocks if present
                if '```json' in cleaned_response:
                    start_marker = '```json'
                    end_marker = '```'
                    start_idx = cleaned_response.find(start_marker)
                    if start_idx != -1:
                        start_idx += len(start_marker)
                        end_idx = cleaned_response.find(end_marker, start_idx)
                        if end_idx != -1:
                            cleaned_response = cleaned_response[start_idx:end_idx].strip()
                        else:
                            cleaned_response = cleaned_response[start_idx:].strip()
                
                # Remove any remaining markdown artifacts
                if cleaned_response.startswith('```'):
                    cleaned_response = cleaned_response[3:].strip()
                if cleaned_response.endswith('```'):
                    cleaned_response = cleaned_response[:-3].strip()
                
                print(f"Cleaned response: {cleaned_response[:200]}...")
                
                # Try to parse the cleaned JSON
                parsed_response = json.loads(cleaned_response)
                print("Successfully parsed JSON response")
                
                # Post-process the response to ensure proper format
                processed_response = post_process_response(parsed_response, ai_resolve_fields)
                
                # Validate the response has the expected structure
                if isinstance(processed_response, dict):
                    if 'title' in processed_response or 'description' in processed_response:
                        return processed_response
                    else:
                        print("Warning: Response missing expected fields, but continuing...")
                        return processed_response
                else:
                    print(f"Warning: Expected dict, got {type(processed_response)}")
                    return processed_response
                
            except json.JSONDecodeError as e:
                print(f"JSON parse error: {e}")
                print(f"Cleaned response: {cleaned_response[:500] if 'cleaned_response' in locals() else response_content[:500]}")
                
                # If JSON parsing fails, try to extract information manually
                fallback_result = extract_info_from_text(response_content, ai_resolve_fields)
                if fallback_result:
                    print("Using fallback text extraction")
                    return post_process_response(fallback_result, ai_resolve_fields)
                else:
                    return {
                        "error": "Could not parse response as JSON",
                        "raw_content": response_content
                    }
                
        except Exception as e:
            retries += 1
            error_msg = str(e)
            print(f"API call error (attempt {retries}/{max_retries + 1}): {error_msg}")
            
            # Check for rate limit and retry with exponential backoff
            if "rate_limit_exceeded" in error_msg and retries <= max_retries:
                wait_time = (2 ** retries) * (1 + random.random())
                print(f"Rate limit hit, waiting {wait_time} seconds before retry")
                time.sleep(wait_time)
                continue
            
            if retries > max_retries:
                break
                
            # Wait before retry
            wait_time = 2 ** retries
            time.sleep(wait_time)
    
    # All retries exhausted
    return {
        "error": f"Failed to process after {max_retries + 1} attempts",
        "last_error": error_msg if 'error_msg' in locals() else "Unknown error"
    }

def post_process_response(response, ai_resolve_fields):
    """Post-process the OpenAI response to ensure proper format and handle AI resolved fields"""
    if not isinstance(response, dict):
        return response
    
    processed = response.copy()
    
    # Handle description field - convert object to string if needed
    if 'description' in processed:
        desc = processed['description']
        
        # If description is an object, convert it to a readable string
        if isinstance(desc, dict):
            print("Converting description object to string")
            
            # Build a readable description from the object
            desc_parts = []
            
            # Add key details in a logical order
            key_order = [
                'Artist', 'Brand/Publisher', 'Subject', 'Theme', 
                'Era', 'Year Manufactured', 'Time Period Manufactured',
                'Material', 'Size', 'Condition', 'Postage Condition',
                'Features', 'Country/Region of Manufacture', 'Continent'
            ]
            
            # First, add items in preferred order
            for key in key_order:
                if key in desc and desc[key] and desc[key] != "N/A":
                    desc_parts.append(f"{key}: {desc[key]}")
            
            # Then add any remaining items
            for key, value in desc.items():
                if key not in key_order and value and value != "N/A":
                    desc_parts.append(f"{key}: {value}")
            
            # Create a readable description
            if desc_parts:
                processed['description'] = ". ".join(desc_parts) + "."
            else:
                processed['description'] = "Product details available upon request."
                
            print(f"Converted description: {processed['description'][:100]}...")
    
    # Ensure title is a string
    if 'title' in processed and not isinstance(processed['title'], str):
        processed['title'] = str(processed['title'])
    
    # Handle AI resolved fields
    if ai_resolve_fields and 'aiResolvedFields' in processed:
        ai_fields = processed['aiResolvedFields']
        if isinstance(ai_fields, dict):
            # Clean up AI resolved field values
            cleaned_ai_fields = {}
            for field_name, field_value in ai_fields.items():
                if field_value and str(field_value).strip() and field_value != "Unknown" and field_value != "Not Specified":
                    cleaned_ai_fields[field_name] = str(field_value).strip()
            
            processed['aiResolvedFields'] = cleaned_ai_fields
            print(f"Processed AI resolved fields: {list(cleaned_ai_fields.keys())}")
        else:
            # If aiResolvedFields is not a dict, remove it
            print("Warning: aiResolvedFields is not a dictionary, removing")
            processed.pop('aiResolvedFields', None)
    
    # Handle any other fields that might be objects but should be strings
    for key, value in processed.items():
        if isinstance(value, dict) and key not in ['storedFieldSelections', 'aiResolvedFields']:
            # Convert other unexpected objects to strings
            processed[key] = json.dumps(value)
            print(f"Converted {key} object to JSON string")
    
    return processed

def extract_info_from_text(text, ai_resolve_fields):
    """Enhanced fallback function to extract title, description, and AI resolved fields from text"""
    try:
        # First, try to find JSON within the text (even if it's malformed)
        import re
        
        # Look for JSON-like structures
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            json_str = json_match.group(0)
            try:
                # Try to parse this JSON
                parsed = json.loads(json_str)
                if isinstance(parsed, dict):
                    print(f"Successfully extracted JSON from text")
                    return parsed
            except:
                pass
        
        # Look for title and description fields specifically
        result = {}
        
        # Pattern 1: Look for "title": "value" patterns
        title_match = re.search(r'"title":\s*"([^"]*)"', text, re.IGNORECASE)
        if title_match:
            result['title'] = title_match.group(1)
        
        # Pattern 2: Look for description object or string
        desc_match = re.search(r'"description":\s*("([^"]*)"|(\{[^}]*\}))', text, re.IGNORECASE | re.DOTALL)
        if desc_match:
            if desc_match.group(2):  # String description
                result['description'] = desc_match.group(2)
            elif desc_match.group(3):  # Object description
                result['description'] = desc_match.group(3)
        
        # Pattern 3: Look for aiResolvedFields if AI resolution is enabled
        if ai_resolve_fields:
            ai_fields_match = re.search(r'"aiResolvedFields":\s*(\{[^}]*\})', text, re.IGNORECASE | re.DOTALL)
            if ai_fields_match:
                try:
                    ai_fields_str = ai_fields_match.group(1)
                    ai_fields = json.loads(ai_fields_str)
                    if isinstance(ai_fields, dict):
                        result['aiResolvedFields'] = ai_fields
                        print(f"Extracted AI resolved fields from text: {list(ai_fields.keys())}")
                except:
                    print("Failed to parse AI resolved fields from text")
        
        # Pattern 4: Try line-by-line parsing for simple formats
        if not result:
            lines = text.strip().split('\n')
            current_field = None
            current_content = []
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                    
                # Look for field markers
                if line.lower().startswith('title:'):
                    if current_field and current_content:
                        result[current_field] = '\n'.join(current_content).strip()
                    current_field = 'title'
                    current_content = [line[6:].strip()]
                elif line.lower().startswith('description:'):
                    if current_field and current_content:
                        result[current_field] = '\n'.join(current_content).strip()
                    current_field = 'description'
                    current_content = [line[12:].strip()]
                elif current_field:
                    current_content.append(line)
            
            # Don't forget the last field
            if current_field and current_content:
                result[current_field] = '\n'.join(current_content).strip()
        
        # Clean up any extracted values
        for key in result:
            if isinstance(result[key], str):
                # Remove quotes if they wrap the entire value
                if result[key].startswith('"') and result[key].endswith('"'):
                    result[key] = result[key][1:-1]
                # Clean up any escape characters
                result[key] = result[key].replace('\\"', '"').replace('\\n', '\n')
        
        # If we found a title at minimum, return the result
        if 'title' in result:
            print(f"Extracted title: {result['title'][:50]}...")
            if 'description' in result:
                print(f"Extracted description: {str(result['description'])[:50]}...")
            return result
        
        # If extraction failed, return None so we fall back to error handling
        return None
        
    except Exception as e:
        print(f"Text extraction error: {e}")
        return None

def estimate_tokens(image_group, prompt, selected_options):
    """
    Roughly estimate token usage for a request.
    This is a very rough estimate - a better implementation would use tiktoken
    """
    # Base tokens for prompt and system message
    prompt_tokens = len(prompt.split()) * 1.3  # Rough conversion from words to tokens
    
    # Tokens for options
    options_tokens = 0
    if selected_options:
        options_tokens = len(json.dumps(selected_options)) * 0.3
    
    # Tokens for images - this is very rough
    # Each image can be 85-100 tokens in "low" detail mode
    image_tokens = len(image_group) * 100
    
    # Tokens for expected output - approx 400 max_tokens for AI field resolution
    output_tokens = 400
    
    # Total estimated tokens
    total_estimated = prompt_tokens + options_tokens + image_tokens + output_tokens
    
    # Add a safety buffer
    return int(total_estimated * 1.2)

# Keep the batching functions but update them for AI field resolution
def process_batched_groups(client, token_bucket, image_groups, prompt, selected_options, batch_size, ai_resolve_fields):
    """Process multiple image groups in a single OpenAI request with AI field resolution support"""
    all_results = []
    
    # Group image groups into batches
    for i in range(0, len(image_groups), batch_size):
        batch = image_groups[i:i + batch_size]
        print(f"Processing batch {i//batch_size + 1} with {len(batch)} groups")
        
        # Estimate tokens for the entire batch
        estimated_tokens = estimate_batch_tokens(batch, prompt, selected_options, ai_resolve_fields)
        
        can_proceed, wait_time = token_bucket.consume(estimated_tokens)
        if not can_proceed:
            time.sleep(wait_time + 0.1)
        
        # Process batch
        batch_results = process_batch_with_retry_fixed(client, batch, prompt, selected_options, ai_resolve_fields)
        
        # Ensure we have the right number of results
        if len(batch_results) != len(batch):
            print(f"Warning: Expected {len(batch)} results, got {len(batch_results)}")
            # Pad with errors if needed
            while len(batch_results) < len(batch):
                batch_results.append({"error": "Missing result from batch processing"})
        
        all_results.extend(batch_results)
    
    print(f"Batch processing complete: {len(all_results)} total results")
    return {
        'statusCode': 200,
        'body': json.dumps(all_results)
    }

def process_batch_with_retry_fixed(client, image_groups_batch, prompt, selected_options, ai_resolve_fields, max_retries=3):
    """FIXED: Process a batch of image groups in a single OpenAI request with AI field resolution"""
    
    # Build enhanced prompt for batch processing
    if selected_options:
        options_str = json.dumps(selected_options, indent=2)
        
        # Fix the f-string issue by constructing the format string separately
        ai_fields_part = '"aiResolvedFields": {}' if ai_resolve_fields else ''
        comma_part = ',' if ai_resolve_fields else ''
        
        batch_prompt = f"""{prompt}

IMPORTANT: You are processing {len(image_groups_batch)} separate product groups. 
Each group represents a different product that needs its own listing.

Please return a JSON array with exactly {len(image_groups_batch)} objects, one for each product group.
Each object should follow this format:
{{
    "title": "Product title here",
    "description": "Product description here"{comma_part}
    {ai_fields_part}
}}

User selected options for context: {options_str}

Process each group of images as a separate product. Return ONLY the JSON array, no additional text."""
    else:
        # Fix the f-string issue by constructing the format string separately
        ai_fields_part = '"aiResolvedFields": {}' if ai_resolve_fields else ''
        comma_part = ',' if ai_resolve_fields else ''
        
        batch_prompt = f"""{prompt}

IMPORTANT: You are processing {len(image_groups_batch)} separate product groups.
Please return a JSON array with exactly {len(image_groups_batch)} objects, one for each product group.
Each object should follow this format:
{{
    "title": "Product title here",
    "description": "Product description here"{comma_part}
    {ai_fields_part}
}}

Return ONLY the JSON array, no additional text."""
    
    # Build image content for all groups
    content = [{"type": "text", "text": batch_prompt}]
    
    for group_idx, image_group in enumerate(image_groups_batch):
        # Add separator text for each group
        content.append({
            "type": "text", 
            "text": f"\n--- PRODUCT GROUP {group_idx + 1} ---"
        })
        
        # Add all images from this group
        for image_base64 in image_group:
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": image_base64,
                    "detail": "low"
                }
            })
    
    retries = 0
    while retries <= max_retries:
        try:
            print(f"Making batch API call (attempt {retries + 1}/{max_retries + 1})")
            
            completion = client.chat.completions.create(
                model="gpt-4o-mini-2024-07-18",
                messages=[{
                    "role": "user",
                    "content": content
                }],
                max_tokens=(1000 if ai_resolve_fields else 800) * len(image_groups_batch),  # Scale tokens with batch size and AI fields
                temperature=0.7
            )
            
            response_content = completion.choices[0].message.content
            print(f"Batch response: {response_content[:200]}...")
            
            try:
                # Clean the response - remove any markdown formatting
                cleaned_response = response_content.strip()
                if cleaned_response.startswith('```json'):
                    cleaned_response = cleaned_response[7:]
                if cleaned_response.endswith('```'):
                    cleaned_response = cleaned_response[:-3]
                cleaned_response = cleaned_response.strip()
                
                # Parse JSON array response
                parsed_response = json.loads(cleaned_response)
                
                # Ensure we have the right number of results
                if isinstance(parsed_response, list):
                    if len(parsed_response) == len(image_groups_batch):
                        print(f"Successfully parsed batch with {len(parsed_response)} results")
                        # Post-process each result in the batch
                        processed_results = [post_process_response(result, ai_resolve_fields) for result in parsed_response]
                        return processed_results
                    else:
                        print(f"Warning: Expected {len(image_groups_batch)} results, got {len(parsed_response)}")
                        # Pad or trim to correct size
                        while len(parsed_response) < len(image_groups_batch):
                            parsed_response.append({"error": "Missing batch result"})
                        # Post-process each result
                        processed_results = [post_process_response(result, ai_resolve_fields) for result in parsed_response[:len(image_groups_batch)]]
                        return processed_results
                elif isinstance(parsed_response, dict):
                    # Single object returned, wrap in array and pad
                    print("Single object returned, expected array")
                    result = [post_process_response(parsed_response, ai_resolve_fields)]
                    while len(result) < len(image_groups_batch):
                        result.append({"error": "Missing batch result"})
                    return result
                else:
                    # Invalid response structure
                    print(f"Invalid response type: {type(parsed_response)}")
                    return [{"error": "Invalid batch response format", "raw_content": response_content}] * len(image_groups_batch)
                    
            except json.JSONDecodeError as e:
                print(f"JSON decode error: {e}")
                print(f"Response content: {response_content}")
                return [{"error": "Could not parse batch response", "raw_content": response_content}] * len(image_groups_batch)
                
        except Exception as e:
            retries += 1
            error_msg = str(e)
            print(f"Batch API error (attempt {retries}/{max_retries + 1}): {error_msg}")
            
            if "rate_limit_exceeded" in error_msg and retries <= max_retries:
                wait_time = (2 ** retries) * (1 + random.random())
                print(f"Rate limit hit, waiting {wait_time} seconds")
                time.sleep(wait_time)
                continue
            
            if retries > max_retries:
                break
                
            wait_time = 2 ** retries
            time.sleep(wait_time)
    
    # Max retries exceeded
    error_result = {"error": "Batch processing failed after max retries"}
    return [error_result] * len(image_groups_batch)

def estimate_batch_tokens(image_groups_batch, prompt, selected_options, ai_resolve_fields):
    """Estimate tokens for a batch of image groups with AI field resolution"""
    # Base tokens for prompt
    prompt_tokens = len(prompt.split()) * 1.3
    
    # Options tokens
    options_tokens = len(json.dumps(selected_options or {})) * 0.3
    
    # Image tokens (100 per image in low detail)
    total_images = sum(len(group) for group in image_groups_batch)
    image_tokens = total_images * 100
    
    # Output tokens (scale with batch size and AI fields)
    base_output_tokens = 400 if ai_resolve_fields else 300
    output_tokens = base_output_tokens * len(image_groups_batch)
    
    # Batch overhead (additional tokens for batch instructions)
    batch_overhead = 50 * len(image_groups_batch)
    
    total = prompt_tokens + options_tokens + image_tokens + output_tokens + batch_overhead
    return int(total * 1.2)  # Safety buffer

def get_prompt_from_dynamodb(category, subCategory):
    """Retrieve prompt from DynamoDB table based on category and subcategory."""
    try:
        # DynamoDB table is already initialized at module level
        table = dynamodb.Table('ListCategory')  # Your actual table name
        
        response = table.get_item(
            Key={
                'Category': category,
                'SubCategory': subCategory
            },
            ProjectionExpression='Prompt'  # Return only the 'Prompt' field
        )
        
        if 'Item' in response:
            prompt = response['Item'].get('Prompt', '')
            print(f"Retrieved prompt for {category}/{subCategory}: {prompt[:100]}...")
            return prompt
        else:
            print(f"No prompt found for {category}/{subCategory}")
            return {
                'error': 'Item not found',
                'statusCode': 404
            }
    except Exception as e:
        print(f"Error fetching prompt from DynamoDB: {e}")
        return {
            'error': str(e),
            'Category': category,
            'SubCategory': subCategory,
            'statusCode': 500
        }

# Environment variables required:
# OPENAI_SECRET_NAME - Name of the secret in AWS Secrets Manager (default: 'openai-api-key')
# OPENAI_API_KEY - Fallback if Secrets Manager fails (not recommended for production)
# BATCH_SIZE - Batch processing size (default: 1)
# USE_BATCHING - Enable batch processing (default: false)

# IAM Role permissions required:
# {
#   "Version": "2012-10-17",
#   "Statement": [
#     {
#       "Effect": "Allow",
#       "Action": [
#         "secretsmanager:GetSecretValue"
#       ],
#       "Resource": "arn:aws:secretsmanager:region:account-id:secret:openai-api-key-*"
#     },
#     {
#       "Effect": "Allow",
#       "Action": [
#         "dynamodb:GetItem"
#       ],
#       "Resource": "arn:aws:dynamodb:region:account-id:table/ListCategory"
#     }
#   ]
# }