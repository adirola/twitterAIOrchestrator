import { DockerizeAgent } from './applicationDockerController';
import { AwsHandler } from '../aws/AwsHandler';
import fs from 'fs';
import path from 'path';

export const processRequest = async (files: { [fieldname: string]: Express.Multer.File[] }, projectName: string, version: string, requestId: string) => {
    const outputPath = path.join(__dirname, '..', 'deployments', `${requestId}.txt`);

    try {
        // 1. Worked has picked up the request for execution.
        fs.writeFileSync(outputPath, JSON.stringify({
            status: "PROCESSING",
            info: "Request is being executed."
        }));

        // 2. Prepare Docker Image for hosting.
        const dockerizePython = new DockerizeAgent();
        const imageUri = await dockerizePython.createImage(files, projectName, version, requestId);
        console.log(`ImageUri`, imageUri);
        fs.writeFileSync(outputPath, JSON.stringify({
            status: "BUILDING",
            info: "Agent Deployment Image Built."
        }));

        //3. Prepare hosting environment.
        const awsHandler = new AwsHandler();
        
        // 3.1 Prepare ECR Repository.
        const ecrRepositoryUri = await awsHandler.createECRRepository(projectName);
        console.log("Worker ECR Repo", ecrRepositoryUri);

        // // 3.2 Upload Docker Image to ECR.
        const ecrUri = await awsHandler.uploadToECR(ecrRepositoryUri, imageUri, version);
        console.log("Worker ECR ImageURi", ecrUri);
        fs.writeFileSync(outputPath, JSON.stringify({
            status: "BUILDING",
            info: "Agent Deployment Image Uploaded."
        }));

        // 3.3 Create App Runner Service or deploy locally
        await awsHandler.createAppRunnerService(ecrUri, projectName);
        fs.writeFileSync(outputPath, JSON.stringify({
            status: "FINISHING",
            info: "Agent is being deployed!"
        }));
    } catch (error: any) {
        fs.writeFileSync(outputPath, JSON.stringify({
            status: "IN-PROGRESS",
            info: `Error: ${error.message}`
        }));
    }
};