/**
 * Simple test to debug Gradio client connection to private space
 */

import { Client } from "@gradio/client";

async function testConnection() {
  console.log("Environment check:");
  console.log(
    `  HF_TOKEN: ${process.env.HF_TOKEN ? "Set (length: " + process.env.HF_TOKEN.length + ")" : "NOT SET"}`,
  );
  console.log("");

  const spaceName = "neiltron/vggt";
  const hfToken = process.env.HF_TOKEN;

  if (!hfToken) {
    console.error("❌ HF_TOKEN not set");
    process.exit(1);
  }

  console.log(`Attempting to connect to ${spaceName}...`);
  console.log(`Using token: ${hfToken.substring(0, 7)}...`);
  console.log("");

  try {
    const client = await Client.connect(spaceName, {
      token: hfToken,
    });

    console.log("✅ Connected successfully!");
    console.log("");
    console.log("Client config:");
    console.log(`  Root: ${client.config?.root}`);
    console.log(`  Version: ${client.config?.version}`);
    console.log("");

    // Try to get API info
    console.log("Fetching API info...");
    const apiInfo = await client.view_api();
    console.log(
      "API info:",
      JSON.stringify(apiInfo, null, 2).substring(0, 500),
    );
  } catch (error) {
    console.error("❌ Connection failed");
    console.error("");
    console.error("Error details:");
    console.error("  Type:", error.constructor.name);
    console.error("  Message:", error.message);
    if (error.stack) {
      console.error("");
      console.error("Stack trace:");
      console.error(error.stack);
    }
    if (error.cause) {
      console.error("");
      console.error("Cause:", error.cause);
    }
    process.exit(1);
  }
}

testConnection();
