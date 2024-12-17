import { AwsHandler } from "../aws/AwsHandler";
import crypto from 'crypto';
import fs from "fs";

export async function uploadFilesToS3(
    projectName: string,
    requestId: string,
    files: {
        [fieldname: string]: Express.Multer.File[]
    }
) {
    try {
        const aws = new AwsHandler();
        
        // Create S3 Bucket.
        const bucketName: string = crypto.createHash('md5').update(`${projectName}`).digest('hex');
        await aws.createS3Bucket(bucketName);

        // Upload files
        const promises = Object.keys(files).map(
            async (key: string) => {
                const file = files[key][0];
                await aws.uploadFilesToS3(
                    bucketName,
                    `${requestId}/${file.originalname}`,
                    fs.readFileSync(file.path)
                );
            }
        );

        await Promise.all(promises);
        console.log(`Document Uploaded Successfully!`);
    } catch (error: any) {
        console.error(`S3 Document Upload failed! ${error.message}`);
        throw error;
    }
}