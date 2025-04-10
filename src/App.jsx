import { useState, useEffect } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import logo from './src/assets/ListEasier.jpg';
import './App.css'

function App() {
    const [responseData, setResponseData] = useState(null);
	const [count, setCount] = useState(0);
	const [base64ImageArray, setbase64ImageArray] = useState(null);
	
	
    const handleClick = () => {
    // Data you want to send with the POST request
	const postData = {
		Base64Key: {base64ImageArray}
		,imageCount:{count}
		};

 
  };

  return (
    <>
      <div>
		<img src={logo} alt="ListEasier Image" class="logoCSS" />
      </div>
      <div className="card">
	  <div class="file-upload">
  <input type="file" name="fileToUpload" id="fileToUpload" />
</div>
<br></br>
        <button>
          Assign to State
        </button>

        <button onClick={handleClick}>
          Generate Listing
        </button>
		 {<pre>{JSON.stringify(responseData, null, 2)}</pre>}
		 {<pre>{base64ImageArray}</pre>}
		 {<pre>{count}</pre>}


      </div>

    </>
  )
}

export default App
