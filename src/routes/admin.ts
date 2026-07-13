import express from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { adjustManagedCredits, createManagedUser, getManagedUserDetail, listManagedUsers, updateManagedUser } from "../services/userService.js";

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireAdmin);

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
