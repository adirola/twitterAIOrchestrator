# Twitter Bot Deployment Application

This application allows users to deploy Twitter bots using custom character configurations on AWS App Runner.

## Dependencies

- Docker
- Docker Compose
- Node.js (>v20)
- AWS Credentials
- Twitter Credentials

## Installation & Setup

1. Create the environment file:
   - Copy the `.env.example` file to create your `.env` file
   - Populate all required variables in the `.env` file

2. Start the PostgreSQL database:
   ```bash
   docker compose up -d db
   ```
   **Note:** Do not run the service via docker compose

3. Run the application:
   - Development mode:
     ```bash
     npm run dev
     ```
   - Production mode:
     Build the application and deploy it in an nginx server
     
   **Note:** The application cannot be run in Docker as it requires host system permissions

## Usage

### Initial Setup

1. Open the application URL in your browser
2. Authenticate with your Twitter account
3. Upload the required configuration files:
   - Character persona file (JSON)
   - Environment file (txt)

### Configuration Files

1. Character File:
   - Use `example.character.json` as a template
   - Rename to `main.character.json` before uploading
   - Documentation: [Character File Format](https://ai16z.github.io/eliza/docs/core/characterfile/)

2. Environment File:
   - Use `agent_env.txt` as a template
   - Rename to `env.tx` before uploading
   - Add your Anthropic API key (or the API key for the model specified in the character file)

## Architecture

### Basic User Flow

1. User accesses the application URL
2. User authenticates their Twitter account
3. User uploads the character JSON file and environment text file
4. The agent is deployed on AWS App Runner

### Technology Stack

- TypeScript
- Node.js
- Docker
- Docker Compose
- AWS SDK

### Deployment Process

1. User authenticates with Twitter
2. Application processes the uploaded agent files
3. Dockerizing engine creates container image
4. Image is uploaded to AWS ECR
5. AWS App Runner deploys the agent

## Contributing

If you'd like to contribute, please fork the repository and make changes as you'd like. Pull requests are warmly welcome.

## License

MIT open Liscence
