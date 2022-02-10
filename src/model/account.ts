import { Static, Type } from "@sinclair/typebox";

export const accountSchema = Type.Strict(Type.Object({
    email: Type.String({ default: "" }),
    token: Type.String({ default: "" }),
    remember: Type.Boolean({ default: true }),
}));

export type Account = Static<typeof accountSchema>;