import express from "express";
import { createTopupIntent, getUserCredits } from "../services/creditService.js";

export const creditsRouter = express.Router();

creditsRouter.get("/summary", async (req, res) => {
  res.json(await getUserCredits(req.authUser!.id, { page: 1, pageSize: 8 }));
});

creditsRouter.get("/transactions", async (req, res) => {
  res.json(await getUserCredits(req.authUser!.id, req.query));
});

creditsRouter.post("/topup-intents", async (req, res) => {
  const intent = await createTopupIntent(req.authUser!.id, req.body);
  res.status(202).json({
    intent,
    message: "充值意向已记录，充值通道即将开放，积分不会立即到账"
  });
});
