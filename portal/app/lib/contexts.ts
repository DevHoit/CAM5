"use client";

import { createContext, useContext } from "react";
import type { ConfirmRequest, NoticeTone, UserRole } from "./types";

export const FeedbackContext = createContext<(message: string, tone?: NoticeTone) => void>(() => undefined);
export const useFeedback = () => useContext(FeedbackContext);
export const ConfirmContext = createContext<(request: ConfirmRequest) => void>(() => undefined);
export const useConfirm = () => useContext(ConfirmContext);
export const RoleContext = createContext<UserRole>("Administrador");
export const useActiveRole = () => useContext(RoleContext);
