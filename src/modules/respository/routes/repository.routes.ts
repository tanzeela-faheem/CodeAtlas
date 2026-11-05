import { Router } from "express";
import { importRepository } from "../controllers/repository.controller.js";

const router = Router();

router.post("/import", importRepository);

export default router;
