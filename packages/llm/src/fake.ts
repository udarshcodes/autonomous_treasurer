import type { z } from "zod";
import type { LlmClient, ObjectRequest } from "./client";

/**
 * Test double. The handler receives the request and returns raw output, which is
 * validated against the schema exactly like the real client does.
 */
export function createFakeLlm(handler: (req: ObjectRequest<z.ZodType>) => unknown | Promise<unknown>): LlmClient & {
  calls: ObjectRequest<z.ZodType>[];
} {
  const calls: ObjectRequest<z.ZodType>[] = [];
  return {
    calls,
    async object<S extends z.ZodType>(req: ObjectRequest<S>): Promise<z.infer<S>> {
      calls.push(req);
      return req.schema.parse(await handler(req));
    },
  };
}
