import { Router } from 'express';
import { createController } from '../controllers/createController';

const router = Router();

router.post('/agent', createController.createAgent);
router.post('/request', createController.createRequest);

export default router;