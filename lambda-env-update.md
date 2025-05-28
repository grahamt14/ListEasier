# Lambda Environment Variables Update

To improve performance, update these environment variables in your Lambda function:

```
USE_BATCHING=true
BATCH_SIZE=5
```

This will enable the Lambda to process up to 5 listings in a single API call, significantly reducing processing time.