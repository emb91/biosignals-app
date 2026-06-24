import { z, type ZodTypeAny } from 'zod';

/**
 * Minimal JSON-Schema -> Zod converter for the subset used by Arcova tool input
 * schemas (object / string+enum / number / integer / boolean / array / nested object).
 * The MCP SDK's `server.tool(name, desc, paramsSchema, cb)` wants a ZodRawShape
 * (the property map), so the registry can keep JSON Schema as its single source of
 * truth and we convert at registration time.
 */

type JsonSchema = {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

function nodeToZod(node: JsonSchema): ZodTypeAny {
  let zt: ZodTypeAny;

  if (Array.isArray(node.enum) && node.enum.length > 0 && node.enum.every((v) => typeof v === 'string')) {
    zt = z.enum(node.enum as [string, ...string[]]);
  } else {
    switch (node.type) {
      case 'string':
        zt = z.string();
        break;
      case 'number':
      case 'integer':
        zt = z.number();
        break;
      case 'boolean':
        zt = z.boolean();
        break;
      case 'array':
        zt = z.array(node.items ? nodeToZod(node.items) : z.any());
        break;
      case 'object':
        zt = z.object(shapeFromObject(node)).passthrough();
        break;
      default:
        zt = z.any();
    }
  }

  if (node.description) zt = zt.describe(node.description);
  return zt;
}

function shapeFromObject(schema: JsonSchema): Record<string, ZodTypeAny> {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, child] of Object.entries(props)) {
    const zt = nodeToZod(child);
    shape[key] = required.has(key) ? zt : zt.optional();
  }
  return shape;
}

/** Convert a top-level object JSON Schema into a ZodRawShape for server.tool(). */
export function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, ZodTypeAny> {
  return shapeFromObject(schema as JsonSchema);
}
