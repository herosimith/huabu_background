import express from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { adjustManagedCredits, createManagedUser, getManagedUserDetail, listManagedUsers, updateManagedUser } from "../services/userService.js";
import { getAdminOverview, getCreditRuleSettings, listAdminCreditTransactions, listAdminTopupIntents, publishCreditRule } from "../services/creditService.js";

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/overview", async (_req, res) => {
  res.json(await getAdminOverview());
});

adminRouter.get("/credit-rules", async (_req, res) => {
  res.json(await getCreditRuleSettings());
});

adminRouter.put("/credit-rules", async (req, res) => {
  const activeRule = await publishCreditRule(req.body, req.authUser!.id);
  res.json({ activeRule, message: `积分规则 v${activeRule.version} 已发布` });
});

adminRouter.get("/credit-transactions", async (req, res) => {
  res.json(await listAdminCreditTransactions(req.query));
});

adminRouter.get("/topup-intents", async (req, res) => {
  res.json(await listAdminTopupIntents(req.query));
});

adminRouter.get("/users", async (req, res) => {
  res.json(await listManagedUsers(req.query));
});

adminRouter.post("/users", async (req, res) => {
  const user = await createManagedUser(req.body, req.authUser!.id);
  res.status(201).json({ user });
});

adminRouter.get("/users/:id", async (req, res) => {
  res.json(await getManagedUserDetail(req.params.id));
});

adminRouter.patch("/users/:id", async (req, res) => {
  const user = await updateManagedUser(req.params.id, req.body, req.authUser!.id);
  res.json({ user });
});

adminRouter.post("/users/:id/credits", async (req, res) => {
  res.json(await adjustManagedCredits(req.params.id, req.body, req.authUser!.id));
});
