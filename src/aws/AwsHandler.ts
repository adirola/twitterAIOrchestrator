import AWS from "aws-sdk";
import dotenv from 'dotenv';
import crypto from "crypto";
import { exec, ExecException } from 'child_process';

// Load env variables.
dotenv.config();

// Set the region globally (optional)
AWS.config.update(
    {
        accessKeyId: `${process.env.AWS_ACCESS_KEY}`,
        secretAccessKey: `${process.env.AWS_SECRET_KEY}`,
        region: `${process.env.AWS_REGION}`,
    }
);

export class AwsHandler {
    private ecr: AWS.ECR;
    private apprunner: AWS.AppRunner
    private iam: AWS.IAM;
    private ec2: AWS.EC2;
    private s3: AWS.S3;

    constructor() {
        this.ecr = new AWS.ECR();
        this.apprunner = new AWS.AppRunner();
        this.iam = new AWS.IAM();
        this.ec2 = new AWS.EC2();
        this.s3 = new AWS.S3();
    }

    private async fetchInstanceId() {
        const tokenResponse = await fetch(
            "http://169.254.169.254/latest/api/token",
            {
                method: "PUT",
                headers: {
                    "X-aws-ec2-metadata-token-ttl-seconds": "21600",
                },
            }
        );
        if (!tokenResponse.ok) {
            throw new Error(`Failed to fetch IMDSv2 token: ${tokenResponse.statusText}`);
        }

        const token = await tokenResponse.text();
        const instanceIdResponse = await fetch(
            "http://169.254.169.254/latest/meta-data/instance-id",
            {
                headers: {
                    "X-aws-ec2-metadata-token": token,
                },
            }
        );
        if (!instanceIdResponse.ok) {
            throw new Error(`Failed to fetch instance ID: ${instanceIdResponse.statusText}`);
        }
        const instanceId = await instanceIdResponse.text();
        return instanceId;
    }

    private async attachIAMRoleToInstance(
        instanceId: string,
        roleName: string
    ) {
        // Create Instance Profile
        try {
            await this.iam.createInstanceProfile(
                {
                    InstanceProfileName: roleName
                }
            ).promise();
        } catch (error: any) {
            if (error.code === 'NoSuchEntity') {
                // Create the instance profile if it doesn't exist
                console.log(`Instance profile ${roleName} does not exist. Creating...`);
                await this.iam.createInstanceProfile({ InstanceProfileName: roleName }).promise();
            } else if (error.code == 'EntityAlreadyExists') {
                console.log(`Instance profile ${roleName} Exists`);
            } else {
                throw error;
            }
        }
        // Add role to instance profile if not already added
        try {
            await this.iam.addRoleToInstanceProfile(
                {
                    InstanceProfileName: roleName,
                    RoleName: roleName
                }
            ).promise();
        } catch (error: any) {
            if (error.code !== 'LimitExceeded') {
                throw error;
            }
        }
        // Associate instance profile with the EC2 instance
        const params = {
            IamInstanceProfile: {
                Name: roleName,
            },
            InstanceId: instanceId,
        };

        try {
            const response = await this.ec2.associateIamInstanceProfile(params).promise();
            console.log('IAM role attached successfully:', response);
        } catch (error: any) {
            console.log('Error attaching IAM role:', error.message);
        }
    }

    private async checkIfRoleExists(
        roleName: string
    ): Promise<string | null> {
        try {
            const result = await this.iam.getRole({ RoleName: roleName }).promise();
            return result.Role.Arn;
        } catch (error: any) {
            if (error.code === 'NoSuchEntity') {
                console.log(`Role ${roleName} does not exist.`);
                return null;
            } else {
                console.error(`Error checking role: ${error.message}`);
                throw error;
            }
        }
    }

    private async createServiceRole() {
        const assumeRolePolicyDocument = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: {
                        Service: 'build.apprunner.amazonaws.com'
                    },
                    Action: 'sts:AssumeRole'
                }
            ]
        };
        const roleName = 'ORCPYARServiceRole';
        const roleDescription = 'Role for AWS App Runner to assume during service deployment';
        let serviceRoleArn: string = "";
        const response = await this.checkIfRoleExists(roleName);
        if (!response) {
            try {
                const createRoleParams: AWS.IAM.CreateRoleRequest = {
                    RoleName: roleName,
                    AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicyDocument),
                    Description: roleDescription
                };

                const data = await this.iam.createRole(createRoleParams).promise();
                console.log('IAM Role created:', data.Role.Arn);
                serviceRoleArn = data.Role.Arn;
            } catch (err: any) {
                console.error('Error creating IAM Role:', err);
                throw err;
            }
        } else {
            serviceRoleArn = response;
        }

        // Attach Policy.
        await this.createAndAttachCustomPolicy(roleName);

        return { serviceRoleArn, roleName };
    }

    private async checkIfPolicyExists(policyName: string) {
        const response = await this.iam.listPolicies().promise();
        const policies: any = response.Policies;
        for (let i = 0; i < policies.length; i++) {
            const policy = policies[i];
            if (policy.PolicyName == policyName) {
                return policy.Arn;
            }
        }
        return null;
    }

    private async createAndAttachCustomPolicy(roleName: string) {
        const policyDocument = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Action": [
                        "logs:CreateLogGroup",
                        "logs:PutRetentionPolicy"
                    ],
                    "Effect": "Allow",
                    "Resource": "arn:aws:logs:*:*:log-group:/aws/apprunner/*"
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "logs:CreateLogStream",
                        "logs:PutLogEvents",
                        "logs:DescribeLogStreams"
                    ],
                    "Resource": [
                        "arn:aws:logs:*:*:log-group:/aws/apprunner/*:log-stream:*"
                    ]
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "events:PutRule",
                        "events:PutTargets",
                        "events:DeleteRule",
                        "events:RemoveTargets",
                        "events:DescribeRule",
                        "events:EnableRule",
                        "events:DisableRule"
                    ],
                    "Resource": "arn:aws:events:*:*:rule/AWSAppRunnerManagedRule*"
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "ecr:GetDownloadUrlForLayer",
                        "ecr:BatchGetImage",
                        "ecr:DescribeImages",
                        "ecr:GetAuthorizationToken",
                        "ecr:BatchCheckLayerAvailability"
                    ],
                    "Resource": "*"
                },
                {
                    "Effect": "Allow",
                    "Action": "s3:*",
                    "Resource": "*"
                }
            ]
        };
        const createPolicyParams = {
            PolicyName: `${roleName}-policy`,
            PolicyDocument: JSON.stringify(policyDocument),
            Description: 'Custom policy for App Runner service role'
        };
        let policyArn: string = "";
        const response = await this.checkIfPolicyExists(createPolicyParams.PolicyName);
        if (!response) {
            try {
                const createPolicyResponse = await this.iam.createPolicy(createPolicyParams).promise();
                const _policyArn = createPolicyResponse.Policy!.Arn;
                if (_policyArn) {
                    policyArn = _policyArn;
                }
                console.log(`Custom Policy Created`, _policyArn);
            } catch (policyError: any) {
                console.error(`Error creating custom policy: ${policyError.message}`);
                throw policyError;
            }
        } else {
            policyArn = response;
        }
        // Attach Policy to the Role.
        try {
            const attachPolicyParams: any = {
                RoleName: roleName,
                PolicyArn: policyArn
            };

            await this.iam.attachRolePolicy(attachPolicyParams).promise();
            console.log(`Attached custom policy to role ${roleName}`);
        } catch (error: any) {
            console.log(error.code);
            console.error(`Error attaching custom policy: ${error.message}`);
            throw error;
        }
    }

    private executeCommand(command: string): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log(`Executing command: ${command}`);

            exec(command, (error: ExecException | null, stdout: string, stderr: string) => {
                if (error) {
                    console.error(`Error executing command: ${command}`);
                    console.error(stderr.trim()); // Log stderr output

                    reject(error);
                } else {
                    console.log(`Command executed successfully: ${command}`);
                    console.log(stdout.trim()); // Log stdout output

                    resolve();
                }
            });
        });
    }

    async attachRoleToInstance(
        roleName: string
    ) {
        try {
            const instanceId = await this.fetchInstanceId();
            console.log('Instance ID:', instanceId);
            await this.attachIAMRoleToInstance(instanceId, roleName);
        } catch (error) {
            console.error('Error:', error);
        }
    }

    async createECRRepository(projectName: string): Promise<string> {
        try {
            const repositoryName = projectName.toLowerCase();
            const result = await this.ecr.createRepository({ repositoryName }).promise();
            console.log(`Repository ${repositoryName} created successfully`);
            return result.repository!.repositoryUri!;
        } catch (error: any) {
            if (error.code === 'RepositoryAlreadyExistsException') {
                const result = await this.ecr.describeRepositories({ repositoryNames: [projectName] }).promise();
                console.log(`Repository ${projectName} already exists`);
                return result.repositories![0].repositoryUri!;
            } else {
                console.error(`Error creating repository: ${error.message}`);
                throw new Error(`Error creating repository: ${error.message}`);
            }
        }
    }

    async uploadToECR(
        ecrRepoUri: string,
        imageUri: string,
        version: string
    ): Promise<string> {
        const ecrUri = `${ecrRepoUri}:${version}`;
        await this.executeCommand(`aws ecr get-login-password --region ${this.ecr.config.region} | docker login --username AWS --password-stdin 296324153710.dkr.ecr.${this.ecr.config.region}.amazonaws.com`)
        await this.executeCommand(`docker tag ${imageUri} ${ecrUri}`);
        await this.executeCommand(`docker push ${ecrUri}`);
        return ecrUri;
    }

    async createAppRunnerService(
        ecrUri: string,
        projectName: string
    ) {
        console.log("ECR URI", ecrUri);

        // Create AWS App Runner service role.
        const { serviceRoleArn: instanceRoleArn, roleName: serviceRoleName } = await this.createServiceRole();
        // Attach Necessary Policies to the AWS App Runner service role.
        await this.attachRoleToInstance(serviceRoleName);

        // Check if the app runner service already exists.
        const arService = await this.getAppRunnerServiceByName(`${projectName}`);
        if (!arService.success) {
            // Construct Create Service Request.
            const params: AWS.AppRunner.CreateServiceRequest = {
                ServiceName: `${projectName}`,
                SourceConfiguration: {
                    ImageRepository: {
                        ImageIdentifier: ecrUri,
                        ImageRepositoryType: 'ECR'
                    },
                    AutoDeploymentsEnabled: true,
                    AuthenticationConfiguration: {
                        AccessRoleArn: instanceRoleArn
                    }
                },
                InstanceConfiguration: {
                    Cpu: '2 vCPU',
                    Memory: '4 GB',
                },
                HealthCheckConfiguration: {
                    Protocol: 'HTTP',
                    Path: "/health",
                    Interval: 10,
                    Timeout: 5,
                    HealthyThreshold: 1,
                    UnhealthyThreshold: 5
                }
            };
            try {
                const data = await this.apprunner.createService(params).promise();
                console.log('App Runner service created:', {
                    service_name: data.Service.ServiceName,
                    service_arn: data.Service.ServiceArn,
                    service_status: data.Service.Status,
                    service_url: data.Service.ServiceUrl,
                    service_image: data.Service.SourceConfiguration.ImageRepository?.ImageIdentifier,
                    service_config: data.Service.InstanceConfiguration
                });
            } catch (err) {
                console.error('Error creating App Runner service:', err);
                throw err;
            }
        } else {
            // App Exists.
            console.log(`App Runner exists! Skipped Creation ... Updating service`);
            await this.updateAppRunnerService(
                arService.details?.arn!,
                ecrUri
            );
        }

    }

    async getAppRunnerServiceByName(serviceName: string) {
        try {
            const response = await this.apprunner.listServices().promise();
            const service = response.ServiceSummaryList?.find(s => s.ServiceName === serviceName);
            if (service !== undefined) {
                // Fetch all details.
                const _response = await this.apprunner.describeService({ ServiceArn: service.ServiceArn! }).promise();
                const version = _response.Service.SourceConfiguration.ImageRepository?.ImageIdentifier.split(":")[1].trim();
                return {
                    success: true,
                    details: {
                        arn: service.ServiceArn,
                        version: version,
                        status: service.Status,
                        url: service.ServiceUrl,
                        image: _response.Service.SourceConfiguration?.ImageRepository?.ImageIdentifier,
                        deployment_id: crypto.createHash('sha256').update(`${serviceName}-${version}`).digest('hex'),
                        agent_config: {
                            vCPUs: Math.ceil(Number(_response.Service.InstanceConfiguration.Cpu) / 1024).toFixed(0),
                            RAM: `${Math.ceil(Number(_response.Service.InstanceConfiguration.Memory) / 1024).toFixed(0)} GB`
                        }
                    }
                };
            }
            return {
                success: false
            }
        } catch (error: any) {
            console.error(`Error checking if App Runner service exists: ${error.code}`, error);
            throw error;
        }
    }

    async getAppRunnerServiceByARN(serviceArn: string) {
        try {
            const response = await this.apprunner.describeService({ ServiceArn: serviceArn }).promise();
            const version = response.Service.SourceConfiguration.ImageRepository?.ImageIdentifier.split(":")[1].trim();
            return {
                success: true,
                details: {
                    arn: response.Service.ServiceArn,
                    version: version,
                    status: response.Service.Status,
                    url: response.Service.ServiceUrl,
                    image: response.Service.SourceConfiguration?.ImageRepository?.ImageIdentifier,
                    deployment_id: crypto.createHash('sha256').update(`${response.Service.ServiceName}-${version}`).digest('hex'),
                    agent_config: {
                        vCPUs: Math.ceil(Number(response.Service.InstanceConfiguration.Cpu) / 1024).toFixed(0),
                        RAM: `${Math.ceil(Number(response.Service.InstanceConfiguration.Memory) / 1024).toFixed(0)} GB`
                    }
                }
            };
        } catch (err: any) {
            console.error(`Error getting App Runner service status: ${err.code}`, err);
            throw err;
        }
    }

    async updateAppRunnerService(serviceArn: string, ecrUri: string) {
        const params: AWS.AppRunner.UpdateServiceRequest = {
            ServiceArn: serviceArn,
            SourceConfiguration: {
                ImageRepository: {
                    ImageIdentifier: ecrUri,
                    ImageRepositoryType: 'ECR'
                }
            }
        };
        try {
            const data = await this.apprunner.updateService(params).promise();
            console.log('App Runner service updated:',
                {
                    service_name: data.Service.ServiceName,
                    service_arn: data.Service.ServiceArn,
                    service_status: data.Service.Status,
                    service_url: data.Service.ServiceUrl,
                    service_image: data.Service.SourceConfiguration.ImageRepository?.ImageIdentifier,
                    service_config: data.Service.InstanceConfiguration
                }
            );
        } catch (error) {
            console.error('Error updating App Runner service:', error);
            throw error;
        }
    }

    async deleteAppRunnerService(serviceName: string) {
        try {
            const data = await this.apprunner.deleteService({ ServiceArn: serviceName }).promise();
            console.log('App Runner service deleted:', data);
        } catch (error) {
            console.error('Error deleting App Runner service:', error);
            throw error;
        }
    }

    async createS3Bucket(
        bucketName: string
    ) {
        try {
            await this.s3.createBucket(
                {
                    Bucket: bucketName
                }
            ).promise();
        } catch (err: any) {
            if (err.name === "BucketAlreadyOwnedByYou") {
                console.log(`Bucket "${bucketName}" already exists and is owned by you.`);
            } else {
                console.error(`S3 Creation Failed: "${bucketName}":`, err);
                throw err;
            }
        }
    }

    async checkS3ForFile(
        bucketName: string,
        filePath: string
    ): Promise<boolean> {
        const params = {
            Bucket: bucketName,
            Key: filePath,
        };

        try {
            await this.s3.headObject(params).promise();
            console.log(`File ${filePath} exists in bucket ${bucketName}.`);
            return true;
        } catch (error: any) {
            if (error.code === 'NotFound') {
                console.log(`File ${filePath} does not exist in bucket ${bucketName}.`);
                return false;
            } else {
                console.error(`Error checking file in S3: ${error.message}`);
                throw error;
            }
        }
    }

    async getS3FileContents(
        bucketName: string,
        filePath: string
    ) {
        const params = {
            Bucket: bucketName,
            Key: filePath,
        };
        try {
            const data = await this.s3.getObject(params).promise();
            return data.Body?.toString('utf-8');
        } catch (error: any) {
            console.error("Error fetching S3 object:", error);
            throw error;
        }
    }

    async uploadFilesToS3(
        bucketName: string,
        fileName: string,
        fileContent: Buffer
    ) {
        const params = {
            Bucket: bucketName,
            Key: `${fileName}`,
            Body: fileContent
        };
        try {
            await this.s3.upload(params).promise();
        } catch (error: any) {
            console.error(`Error uploading ${fileName} to S3 ${bucketName}`, error);
        }
    }
}
