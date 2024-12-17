import { Docker } from 'docker-cli-js';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import AdmZip from 'adm-zip';

dotenv.config();

export class DockerizeAgent {
    private docker: Docker;

    constructor() {
        this.docker = new Docker();
    }

    async createImage(
        files: {
            [fieldname: string]: Express.Multer.File[]
        },
        projectName: string,
        version: string,
        requestId: string
    ): Promise<string> {
        // Create Necessary Directories.
        const tempDir = path.join(__dirname, "..", 'temp', requestId);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        };

        // Copy files into the directory.
        for (const key in files) {
            fs.copyFileSync(files[key][0].path, path.join(tempDir, files[key][0].originalname));
        }

        // // Create Dockerfile.
        this.createDockerFile(tempDir);

        const zipPath: string = path.join(__dirname,'..','agent' ,'aiagent.zip');

        this._copyRecursively(zipPath,tempDir);

        // Create Holder S3 Bucket. (Bucket Name would be the hash of ProjectName provided by the user)
        // const aws = new AwsHandler();
        // const bucketName: string = crypto.createHash('md5').update(`${projectName}`).digest('hex');
        // await aws.createS3Bucket(bucketName);

        // Create Env File.
        this.createEnvFile(requestId, tempDir);

        // Build Docker Image.
        const imageName = `${projectName}:${version}`;
        const buildContext = path.resolve(tempDir);

        console.log(buildContext);

        try {
            const buildResult = await this.docker.command(`build -t ${imageName} ${buildContext}`);
            console.log('Docker build output:', buildResult);
            console.log('Docker image build completed successfully');

            const containerName = `${projectName}-container`;
            console.log('Starting Docker container...');
            await this.docker.command(`run -d --name ${containerName} -p 3000:3000 ${imageName}`);
            console.log(`Docker container started successfully. Container name: ${containerName}`);
            
            // Print container info
            const containerInfo = await this.docker.command(`ps --filter name=${containerName}`);
            console.log('Container information:', containerInfo);

            return imageName;
        } catch (error) {
            console.error('Error building Docker image:', error);
            throw error;
        }
    }

    private createEnvFile(
        requestId: string,
        dirPath: string
    ) {
        // Copy Original Env variables.
        const envFilePath = path.join(dirPath, ".env");
        fs.copyFileSync(path.join(dirPath, "env.txt"), envFilePath);
        // Define Additional Environment variables
        console.log("Created Env File");
    }

    private createDockerFile(
        dirPath: string
    ) {
        const dockerfilePath = path.join(dirPath, 'Dockerfile');
        const dockerPath = path.join(__dirname, '..', 'agent', 'Dockerfile');
        fs.copyFileSync(dockerPath, dockerfilePath);
        console.log(`Dockerfile created at ${dockerfilePath}`);
    }


    private _copyRecursively = (sourceDir : string, targetDir:string) => {
        // Create target directory if it doesn't exist
        try {
            // Create target directory if it doesn't exist
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
    
            const zip = new AdmZip(sourceDir);
            zip.extractAllTo(targetDir, true);
            console.log(`Successfully extracted zip contents to ${targetDir}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`Error extracting zip file: ${errorMessage}`);
            throw error;
        }
    }
}
