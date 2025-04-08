import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

function App() {
  
    const handleClick = () => {
    // Data you want to send with the POST request
    const postData = {
    };
	


    fetch("https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI", {
      method: "POST",
      //headers: {
        "Content-Type": "application/json", // Content-Type for JSON data
      //},
      //body: JSON.stringify(postData), // Convert object to JSON string
    })
      //.then((response) => response.json()) // Parse the JSON response
      .then((data) => {
        //setResponseData(data); // Set response data in state
        console.log(data);
      })
      .catch((error) => console.error("Error CALLING API:", error));
  };

  return (
    <>
      <div>
        <img src="src/assets/ListEasier.jpg" alt="ListEasier Image" class="logoCSS" />
      </div>
      <div className="card">
	  <div class="file-upload">
  <input type="file" name="fileToUpload" id="fileToUpload" />
</div>
<br></br>

        <button onClick={handleClick}>
          Generate Listing
        </button>


      </div>

    </>
  )
}

export default App
