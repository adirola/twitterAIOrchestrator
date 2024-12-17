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

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Create Agent</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              max-width: 800px; 
              margin: 0 auto; 
              padding: 20px; 
            }
            .form-group { 
              margin-bottom: 20px; 
              padding: 15px;
              border: 1px solid #ddd;
              border-radius: 5px;
            }
            .file-label {
              display: block;
              margin-bottom: 10px;
              font-weight: bold;
            }
            .file-input {
              display: block;
              width: 100%;
              padding: 8px;
              margin-top: 5px;
              border: 1px solid #ccc;
              border-radius: 4px;
            }
            .file-preview {
              margin-top: 10px;
              padding: 10px;
              background-color: #f5f5f5;
              border-radius: 4px;
              display: none;
            }
            button { 
              padding: 12px 24px;
              background: #007bff;
              color: white;
              border: none;
              border-radius: 5px;
              cursor: pointer;
              font-size: 16px;
            }
            button:hover { 
              background: #0056b3;
            }
            .error {
              color: red;
              margin-top: 5px;
              display: none;
            }
            .form-header {
              margin-bottom: 20px;
            }
            .project-info {
              margin-bottom: 20px;
            }
          </style>
        </head>
        <body>
          <h1>Welcome!</h1>
          <div class="form-header">
            <h2>Create Agent</h2>
          </div>
          
          <form id="agentForm" action="/create/agent" method="POST" enctype="multipart/form-data">
            <div class="project-info">
              <div class="form-group">
                <label for="projectName">Project Name:</label>
                <input type="text" id="projectName" name="projectName" required class="file-input">
              </div>
              <div class="form-group">
                <label for="version">Version:</label>
                <input type="text" id="version" name="version" required class="file-input">
              </div>
            </div>

            <div class="form-group">
              <label class="file-label" for="main_json">Main Configuration:</label>
              <input 
                type="file" 
                id="main_json" 
                name="main.json" 
                class="file-input"
                accept=".json"
                onchange="validateFile(this)"
                required
              />
              <div id="main_json_preview" class="file-preview"></div>
              <div id="main_json_error" class="error"></div>
            </div>

            <div class="form-group">
              <label class="file-label" for="dev_json">Dev Configuration:</label>
              <input 
                type="file" 
                id="dev_json" 
                name="dev.json" 
                class="file-input"
                accept=".json"
                onchange="validateFile(this)"
                required
              />
              <div id="dev_json_preview" class="file-preview"></div>
              <div id="dev_json_error" class="error"></div>
            </div>

            <div class="form-group">
              <label class="file-label" for="bd_json">BD Configuration:</label>
              <input 
                type="file" 
                id="bd_json" 
                name="bd.json" 
                class="file-input"
                accept=".json"
                onchange="validateFile(this)"
                required
              />
              <div id="bd_json_preview" class="file-preview"></div>
              <div id="bd_json_error" class="error"></div>
            </div>

            <button type="submit">Create Agent</button>
          </form>

          <script>
            function validateFile(input) {
              const file = input.files[0];
              const previewDiv = document.getElementById(input.id + '_preview');
              const errorDiv = document.getElementById(input.id + '_error');
              
              // Reset displays
              previewDiv.style.display = 'none';
              errorDiv.style.display = 'none';
              
              if (file) {
                // Check file extension
                if (!file.name.endsWith('.json')) {
                  errorDiv.textContent = 'File must be a JSON file';
                  errorDiv.style.display = 'block';
                  input.value = '';
                  return;
                }

                // Preview content
                const reader = new FileReader();
                reader.onload = function(e) {
                  try {
                    const content = JSON.parse(e.target.result);
                    previewDiv.textContent = JSON.stringify(content, null, 2);
                    previewDiv.style.display = 'block';
                  } catch (err) {
                    errorDiv.textContent = 'Invalid JSON format';
                    errorDiv.style.display = 'block';
                    input.value = '';
                  }
                };
                reader.readAsText(file);
              }
            }
          </script>
        </body>
      </html>
  `);
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