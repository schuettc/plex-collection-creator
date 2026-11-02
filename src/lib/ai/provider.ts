import { createAnthropic } from "@ai-sdk/anthropic";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import {
  AIProvider,
  AnthropicCredentials,
  BedrockCredentials,
  VertexCredentials,
  OpenAICredentials,
  getProviderInfo,
} from "./types";
import { db, settings } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/encryption";
import { eq } from "drizzle-orm";

/**
 * Fast/cheap model IDs for lightweight tasks (deduplication, etc.)
 */
const FAST_MODELS: Record<AIProvider, string> = {
  anthropic: process.env.ANTHROPIC_FAST_MODEL || "claude-3-haiku-20240307",
  bedrock: "anthropic.claude-3-haiku-20240307-v1:0",
  vertex: "claude-3-haiku@20240307",
  openai: "gpt-4o-mini",
};

/**
 * Create an AI model instance based on provider and credentials
 */
export function createAIModel(
  provider: AIProvider,
  credentials: Record<string, string>,
  modelId?: string
) {
  const providerInfo = getProviderInfo(provider);
  const envModel =
    provider === "anthropic" ? process.env.ANTHROPIC_MODEL : undefined;
  const model = modelId || envModel || providerInfo?.defaultModel || "";

  switch (provider) {
    case "anthropic": {
      const creds = credentials as unknown as AnthropicCredentials;
      const anthropic = createAnthropic({
        apiKey: creds.apiKey,
      });
      return anthropic(model);
    }

    case "bedrock": {
      const creds = credentials as unknown as BedrockCredentials;
      const bedrock = createAmazonBedrock({
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        region: creds.region,
      });
      return bedrock(model);
    }

    case "vertex": {
      const creds = credentials as unknown as VertexCredentials;
      const vertex = createVertex({
        project: creds.projectId,
        location: creds.location,
      });
      return vertex(model);
    }

    case "openai": {
      const creds = credentials as unknown as OpenAICredentials;
      const openai = createOpenAI({
        apiKey: creds.apiKey,
        baseURL: creds.baseUrl || undefined,
      });
      return openai(model);
    }

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Test AI provider connection with a simple prompt
 */
export async function testAIConnection(
  provider: AIProvider,
  credentials: Record<string, string>
): Promise<{ success: boolean; message: string; latencyMs?: number }> {
  try {
    const startTime = Date.now();
    const model = createAIModel(provider, credentials);

    // Simple test prompt
    const { text } = await generateText({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any, // Type assertion needed due to AI SDK package version mismatches
      prompt: "Reply with exactly: OK",
    });

    const latencyMs = Date.now() - startTime;

    if (text.toLowerCase().includes("ok")) {
      return {
        success: true,
        message: `Connected successfully (${latencyMs}ms)`,
        latencyMs,
      };
    }

    return {
      success: true,
      message: `Connected (unexpected response: ${text.substring(0, 50)})`,
      latencyMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Parse common error messages
    if (message.includes("401") || message.includes("Unauthorized")) {
      return { success: false, message: "Invalid API key or credentials" };
    }
    if (message.includes("403") || message.includes("Forbidden")) {
      return { success: false, message: "Access denied - check permissions" };
    }
    if (message.includes("404") || message.includes("Not Found")) {
      return { success: false, message: "Model or endpoint not found" };
    }
    if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
      return { success: false, message: "Connection timeout" };
    }

    return { success: false, message };
  }
}

/**
 * Save AI configuration to database (encrypted)
 */
export async function saveAIConfig(
  provider: AIProvider,
  credentials: Record<string, string>
): Promise<void> {
  const encryptedCredentials = encrypt(JSON.stringify(credentials));

  const existing = await db.select().from(settings).limit(1);

  if (existing.length > 0) {
    await db
      .update(settings)
      .set({
        aiProvider: provider,
        aiCredentials: encryptedCredentials,
        updatedAt: new Date(),
      })
      .where(eq(settings.id, existing[0].id));
  } else {
    await db.insert(settings).values({
      aiProvider: provider,
      aiCredentials: encryptedCredentials,
    });
  }
}

/**
 * Check for AI credentials in environment variables.
 * Returns provider and credentials if found, null otherwise.
 */
function getCredentialsFromEnv(): {
  provider: AIProvider;
  credentials: Record<string, string>;
} | null {
  // Check Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      credentials: { apiKey: process.env.ANTHROPIC_API_KEY },
    };
  }

  // Check OpenAI
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      credentials: {
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL || "",
      },
    };
  }

  // Check AWS Bedrock
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      provider: "bedrock",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || "us-east-1",
      },
    };
  }

  // Check Google Vertex AI
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    return {
      provider: "vertex",
      credentials: {
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
      },
    };
  }

  return null;
}

/**
 * Get AI configuration.
 * Priority: 1) Environment variables, 2) Database (encrypted)
 */
export async function getAIConfig(): Promise<{
  provider: AIProvider | null;
  credentials: Record<string, string> | null;
  configured: boolean;
  source: "env" | "database" | null;
}> {
  // Priority 1: Check environment variables
  const envConfig = getCredentialsFromEnv();
  if (envConfig) {
    return {
      provider: envConfig.provider,
      credentials: envConfig.credentials,
      configured: true,
      source: "env",
    };
  }

  // Priority 2: Check database
  const result = await db.select().from(settings).limit(1);

  if (result.length === 0 || !result[0].aiProvider || !result[0].aiCredentials) {
    return { provider: null, credentials: null, configured: false, source: null };
  }

  try {
    const credentials = JSON.parse(decrypt(result[0].aiCredentials));
    return {
      provider: result[0].aiProvider as AIProvider,
      credentials,
      configured: true,
      source: "database",
    };
  } catch (error) {
    console.error("Error decrypting AI credentials:", error);
    return { provider: null, credentials: null, configured: false, source: null };
  }
}

/**
 * Get a configured AI model instance from stored settings
 */
export async function getConfiguredAIModel() {
  const config = await getAIConfig();

  if (!config.configured || !config.provider || !config.credentials) {
    return null;
  }

  return createAIModel(config.provider, config.credentials);
}

/**
 * Get a fast/cheap model for lightweight tasks (deduplication, validation, etc.)
 * Uses Haiku for Claude providers, gpt-4o-mini for OpenAI
 */
export async function getFastAIModel() {
  const config = await getAIConfig();

  if (!config.configured || !config.provider || !config.credentials) {
    return null;
  }

  const fastModelId = FAST_MODELS[config.provider];
  return createAIModel(config.provider, config.credentials, fastModelId);
}

/**
 * Clear AI configuration
 */
export async function clearAIConfig(): Promise<void> {
  const existing = await db.select().from(settings).limit(1);

  if (existing.length > 0) {
    await db
      .update(settings)
      .set({
        aiProvider: null,
        aiCredentials: null,
        updatedAt: new Date(),
      })
      .where(eq(settings.id, existing[0].id));
  }
}
