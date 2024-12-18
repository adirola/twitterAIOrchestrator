import { Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {processRequest} from './fileProcessorController'
import { uploadFilesToS3 } from './s3HelperController';
import { AwsHandler } from '../aws/AwsHandler';

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '..', 'uploads'));
    },
    filename: (req, file, cb) => {
        // Generate unique filename using crypto
        const { projectName, version } = req.body;
        const requestId = crypto.createHash('sha256').update(`${projectName}-${version}`).digest('hex');
        const outputPath = path.join(__dirname, '..', 'outputs', `${requestId}.txt`);
        if (fs.existsSync(outputPath)) {
            cb(new Error("Version name already used for the project"), "");
        } else {
            cb(null, `${file.originalname.split('.').slice(0, -1)}-${requestId}${path.extname(file.originalname)}`);
        }
    }
});

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // Check file extension
    const ext = path.extname(file.originalname).toLowerCase();
    
    // Check MIME type and extension
    if (
        (file.mimetype === 'application/json' && ext === '.json') ||
        (file.mimetype === 'text/plain' && ext === '.txt')
    ) {
        cb(null, true);
    } else {
        cb(new Error('Only .json and .txt files are allowed'));
    }
};

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 50 // 50MB limit per file
    },
    fileFilter: fileFilter
}).fields([
    { name: 'main.json' },
    { name: 'env.txt' },
]);

const depDir = path.join(__dirname, '..', 'deployments');
if (!fs.existsSync(depDir)) {
    fs.mkdirSync(depDir);
}

const agentDir = path.join(__dirname, '..', 'agents');
if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir);
}

if (!fs.existsSync(path.join(__dirname, '..', 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, '..', 'uploads'));
}

export const createController = {
    createAgent: async (req: Request, res: Response) => {
        try {
            upload(req, res, async function (err) {
                if (err) {
                    console.error('Error uploading files', err);
                    return res.status(400).json({ error: err.message });
                }
                const { projectName, version } = req.body;
                try {
                    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
                    if (
                        !projectName ||
                        !version ||
                        !files['main.json'] ||
                        !files['env.txt']
                    ) {
                        return res.status(400).json({ error: 'Missing required files or parameters' });
                    }
                    // Create RequestId & AgentId
                    const agentId = crypto.createHash('md5').update(`${projectName}`).digest('hex');
                    const requestId = crypto.createHash('sha256').update(`${projectName}-${version}`).digest('hex');

                    // Upload Documents to S3.
                    await uploadFilesToS3(
                        projectName,
                        requestId,
                        files
                    );
    
                    // Store Progress.
                    const initialOutput: any = {
                        status: "IN-PROGRESS",
                        info: "Processing the Request"
                    };
    
                    // Store Deployment Versions.
                    const outputPath = path.join(__dirname, '..', 'deployments', `${requestId}.txt`);
                    fs.writeFileSync(outputPath, JSON.stringify(initialOutput));
    
                    // Store ProjectId with Name.
                    const agentPath = path.join(__dirname, '..', 'agents', `${agentId}.txt`);
                    fs.writeFileSync(agentPath, JSON.stringify(
                        {
                            project_name: projectName,
                            deployment_id: requestId
                        }
                    ));
    
                    try {
                        await processRequest(files, projectName, version, requestId);
                    } catch (processError: any) {
                        console.log("Process Error", processError);
                    }
                    return res.json(
                        {
                            success: true,
                            agent_id: agentId,
                            request_id: requestId
                        }
                    );
                } catch (multerError: any) {
                    console.log(`Multe Error:`, multerError);
                }
            });
        } catch (error) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    },

    createRequest: async (req: Request, res: Response) => {
        try {
            const requestData = req.body;
            
            return res.status(201).json({
                success: true,
                message: 'Request created successfully',
                data: requestData
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
};