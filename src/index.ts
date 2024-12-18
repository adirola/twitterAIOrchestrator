import express from 'express';
import session from 'express-session';
import { TwitterApi } from 'twitter-api-v2';
import dotenv from 'dotenv';
import { UserService } from './services/userService';
import createRoutes from './routes/createRoutes';

dotenv.config();

const app = express();
const PORT = 4000;
const userService = new UserService();

app.use(
  session({
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
  })
);

const client = new TwitterApi({
  clientId: process.env.TWITTER_CLIENT_ID!,
  clientSecret: process.env.TWITTER_CLIENT_SECRET!,
});

declare module 'express-session' {
  interface SessionData {
    twitter_id?: string;
    state?: string;
    codeVerifier?: string;
  }
}

app.get('/', (req, res) => {
  res.send(`
    <h1>Twitter OAuth</h1>
    <a href="/auth/twitter">Connect with Twitter</a>
  `);
});

app.get('/auth/twitter', async (req, res) => {
  try {
    const { url, state, codeVerifier } = await client.generateOAuth2AuthLink(
      process.env.CALLBACK_URL!,
      { scope: ['tweet.read', 'tweet.write', 'users.read','offline.access'] }
    );

    req.session.state = state;
    req.session.codeVerifier = codeVerifier;

    res.redirect(url);
  } catch (error) {
    console.error('Error during Twitter auth:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/callback', async (req, res) => {
    const { state, code } = req.query;
    const sessionState = req.session.state;
    const codeVerifier = req.session.codeVerifier;
  
    if (!state || !sessionState || !code || state !== sessionState) {
      return res.status(400).send('Invalid state parameter');
    }
  
    try {
      const datafromTwitter = await client.loginWithOAuth2({
        code: code as string,
        codeVerifier: codeVerifier!,
        redirectUri: process.env.CALLBACK_URL!,
      });

      console.log(datafromTwitter)
  
      const userClient = new TwitterApi(datafromTwitter.accessToken);
      const me = await userClient.v2.me();
  
      await userService.createOrUpdateUser(
        me.data.id,
        me.data.username,
        datafromTwitter.accessToken,
        datafromTwitter.refreshToken || null,  // Handle null refresh token
        datafromTwitter.expiresIn || undefined // Handle undefined expiresIn
      );
  
      req.session.twitter_id = me.data.id;
      res.redirect('/profile');
    } catch (error) {
      console.error('Error during callback:', error);
      res.status(500).send('Authentication failed');
    }
  });

app.get('/profile', async (req, res) => {
  const twitterId = req.session.twitter_id;

  if (!twitterId) {
    return res.redirect('/');
  }

  try {
    const user = await userService.getUserByTwitterId(twitterId);
    if (!user) {
      return res.redirect('/');
    }

    const accessToken = await userService.refreshTokenIfNeeded(user);
    const userClient = new TwitterApi(accessToken);
    const me = await userClient.v2.me();

    const twitterCredsJson = JSON.stringify({
      CLIENT_ID: process.env.CLIENT_ID || '',
      CLIENT_SECRET: process.env.CLIENT_SECRET || '',
      TWITTER_ACCESS_TOKEN: user.access_token || '',
      TWITTER_REFRESH_TOKEN: user.refresh_token || ''
    });

    res.send('<!DOCTYPE html>\n\
      <html>\n\
        <head>\n\
          <title>Create Agent</title>\n\
          <style>\n\
            body { \n\
              font-family: Arial, sans-serif; \n\
              max-width: 800px; \n\
              margin: 0 auto; \n\
              padding: 20px; \n\
            }\n\
            .form-group { \n\
              margin-bottom: 20px; \n\
              padding: 15px;\n\
              border: 1px solid #ddd;\n\
              border-radius: 5px;\n\
            }\n\
            .file-label {\n\
              display: block;\n\
              margin-bottom: 10px;\n\
              font-weight: bold;\n\
            }\n\
            .file-description {\n\
              color: #666;\n\
              font-size: 0.9em;\n\
              margin-bottom: 10px;\n\
            }\n\
            .file-input {\n\
              display: block;\n\
              width: 100%;\n\
              padding: 8px;\n\
              margin-top: 5px;\n\
              border: 1px solid #ccc;\n\
              border-radius: 4px;\n\
            }\n\
            .file-preview {\n\
              margin-top: 10px;\n\
              padding: 10px;\n\
              background-color: #f5f5f5;\n\
              border-radius: 4px;\n\
              display: none;\n\
              white-space: pre-wrap;\n\
              font-family: monospace;\n\
              font-size: 12px;\n\
            }\n\
            button { \n\
              padding: 12px 24px;\n\
              background: #007bff;\n\
              color: white;\n\
              border: none;\n\
              border-radius: 5px;\n\
              cursor: pointer;\n\
              font-size: 16px;\n\
            }\n\
            button:hover { \n\
              background: #0056b3;\n\
            }\n\
            .error {\n\
              color: red;\n\
              margin-top: 5px;\n\
              display: none;\n\
            }\n\
          </style>\n\
        </head>\n\
        <body>\n\
          <h1>Welcome, ' + me.data.username + '!</h1>\n\
          <form id="agentForm" action="/create/agent" method="POST" enctype="multipart/form-data">\n\
            <div class="form-group">\n\
              <label class="file-label" for="main_json">Character Configuration File:</label>\n\
              <div class="file-description">Upload your main.character.json file</div>\n\
              <input \n\
                type="file" \n\
                id="main_json" \n\
                name="main.json" \n\
                class="file-input"\n\
                accept=".json"\n\
                onchange="validateJsonFile(this)"\n\
                required\n\
              />\n\
              <div id="main_json_preview" class="file-preview"></div>\n\
              <div id="main_json_error" class="error"></div>\n\
            </div>\n\
\n\
            <div class="form-group">\n\
              <label class="file-label" for="env_file">Environment Configuration File:</label>\n\
              <div class="file-description">Upload your env.txt file</div>\n\
              <input \n\
                type="file" \n\
                id="env_file" \n\
                name="env.txt" \n\
                class="file-input"\n\
                accept=".txt"\n\
                onchange="validateEnvFile(this)"\n\
                required\n\
              />\n\
              <div id="env_file_preview" class="file-preview"></div>\n\
              <div id="env_file_error" class="error"></div>\n\
            </div>\n\
\n\
            <button type="submit">Create Agent</button>\n\
          </form>\n\
\n\
          <script>\n\
            // Parse the Twitter credentials from the server-side JSON\n\
            const twitterCreds = ' + twitterCredsJson + ';\n\
\n\
            function validateJsonFile(input) {\n\
              const file = input.files[0];\n\
              const previewDiv = document.getElementById(input.id + "_preview");\n\
              const errorDiv = document.getElementById(input.id + "_error");\n\
              \n\
              // Reset displays\n\
              previewDiv.style.display = "none";\n\
              errorDiv.style.display = "none";\n\
              \n\
              if (file) {\n\
                // Check file extension\n\
                if (!file.name.endsWith(".json")) {\n\
                  errorDiv.textContent = "File must be a JSON file";\n\
                  errorDiv.style.display = "block";\n\
                  input.value = "";\n\
                  return;\n\
                }\n\
\n\
                // Preview content\n\
                const reader = new FileReader();\n\
                reader.onload = function(e) {\n\
                  try {\n\
                    const content = JSON.parse(e.target.result);\n\
                    previewDiv.textContent = JSON.stringify(content, null, 2);\n\
                    previewDiv.style.display = "block";\n\
                  } catch (err) {\n\
                    errorDiv.textContent = "Invalid JSON format";\n\
                    errorDiv.style.display = "block";\n\
                    input.value = "";\n\
                  }\n\
                };\n\
                reader.readAsText(file);\n\
              }\n\
            }\n\
\n\
            function validateEnvFile(input) {\n\
              const file = input.files[0];\n\
              const previewDiv = document.getElementById(input.id + "_preview");\n\
              const errorDiv = document.getElementById(input.id + "_error");\n\
              \n\
              // Reset displays\n\
              previewDiv.style.display = "none";\n\
              errorDiv.style.display = "none";\n\
              \n\
              if (file) {\n\
                // Check file extension\n\
                if (!file.name.endsWith(".txt")) {\n\
                  errorDiv.textContent = "File must be a .txt file";\n\
                  errorDiv.style.display = "block";\n\
                  input.value = "";\n\
                  return;\n\
                }\n\
\n\
                // Preview content\n\
                const reader = new FileReader();\n\
                reader.onload = function(e) {\n\
                  try {\n\
                    let content = e.target.result;\n\
                    \n\
                    // Split content into lines and remove empty ones\n\
                    const lines = content.split("\\n").filter(line => line.trim());\n\
                    const existingFields = new Set(\n\
                      lines.map(line => line.split("=")[0].trim())\n\
                    );\n\
\n\
                    // Add missing Twitter credentials\n\
                    let newContent = content;\n\
                    \n\
                    // Add each missing credential\n\
                    const credentialsToAdd = [];\n\
                    if (!existingFields.has("CLIENT_ID") && twitterCreds.CLIENT_ID) {\n\
                      credentialsToAdd.push("CLIENT_ID=" + twitterCreds.CLIENT_ID);\n\
                    }\n\
                    if (!existingFields.has("CLIENT_SECRET") && twitterCreds.CLIENT_SECRET) {\n\
                      credentialsToAdd.push("CLIENT_SECRET=" + twitterCreds.CLIENT_SECRET);\n\
                    }\n\
                    if (!existingFields.has("TWITTER_ACCESS_TOKEN") && twitterCreds.TWITTER_ACCESS_TOKEN) {\n\
                      credentialsToAdd.push("TWITTER_ACCESS_TOKEN=" + twitterCreds.TWITTER_ACCESS_TOKEN);\n\
                    }\n\
                    if (!existingFields.has("TWITTER_REFRESH_TOKEN") && twitterCreds.TWITTER_REFRESH_TOKEN) {\n\
                      credentialsToAdd.push("TWITTER_REFRESH_TOKEN=" + twitterCreds.TWITTER_REFRESH_TOKEN);\n\
                    }\n\
\n\
                    // Add new credentials if any were found\n\
                    if (credentialsToAdd.length > 0) {\n\
                      if (!newContent.endsWith("\\n")) {\n\
                        newContent += "\\n";\n\
                      }\n\
                      newContent += credentialsToAdd.join("\\n") + "\\n";\n\
                    }\n\
                    \n\
                    // Create a new Blob and reassign it to the file input\n\
                    const newFile = new Blob([newContent], { type: "text/plain" });\n\
                    const dataTransfer = new DataTransfer();\n\
                    dataTransfer.items.add(new File([newFile], file.name, { type: "text/plain" }));\n\
                    input.files = dataTransfer.files;\n\
                    \n\
                    previewDiv.textContent = newContent;\n\
                    previewDiv.style.display = "block";\n\
                  } catch (err) {\n\
                    console.error("Error processing env file:", err);\n\
                    errorDiv.textContent = "Error processing file";\n\
                    errorDiv.style.display = "block";\n\
                    input.value = "";\n\
                  }\n\
                };\n\
                reader.readAsText(file);\n\
              }\n\
            }\n\
          </script>\n\
        </body>\n\
      </html>');
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).send('Failed to fetch profile');
  }
});

app.post('/tweet', express.urlencoded({ extended: true }), async (req, res) => {
    const twitterId = req.session.twitter_id;
    const { tweet } = req.body;
  
    if (!twitterId) {
      return res.redirect('/');
    }
  
    try {
      const user = await userService.getUserByTwitterId(twitterId);
      if (!user) {
        return res.redirect('/');
      }
  
      // Get the current access token (may or may not be refreshed)
      const accessToken = await userService.refreshTokenIfNeeded(user);
      const userClient = new TwitterApi(accessToken);
  
      try {
        await userClient.v2.tweet(tweet);
        res.send('Tweet posted successfully! <a href="/profile">Back to profile</a>');
      } catch (error) {
        // If tweeting fails, might be an authorization issue
        console.error('Error posting tweet:', error);
        res.redirect('/auth/twitter'); // Redirect to reauthorize
      }
    } catch (error) {
      console.error('Error in tweet route:', error);
      res.status(500).send('Failed to post tweet');
    }
  });

app.use('/create', createRoutes);



app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});