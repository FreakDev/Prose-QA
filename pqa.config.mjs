export default {
  llm: {
    provider: "openai-compatible",
    model: "qwen/qwen3.5-9b",
    baseURL: "http://10.0.0.97:1234/v1",
    thinking: {
      enabled: true,
      reasoningEffort: "none",
    },
  },
  // llm: {
  //   provider: "fireworks",
  //   model: "accounts/fireworks/models/deepseek-v4-flash",
  //   thinking: {
  //     enabled: true,
  //   },
  // },
  envVars: ["PQA_TEST_EMAIL", "PQA_TEST_PASSWORD"],
  auth: {
    admin: {
      scenario: "login-admin",
    },
  },
  // llm: {
  //   provider: "google",
  //   model: "gemini-2.5-flash",
  //   thinking: {
  //     enabled: true,
  //     reasoningEffort: "none",
  //   },
  // },
  // llm: {
  //   provider: "openai-compatible",
  //   model: "gemma4:12b-it-qat",
  //   baseURL: "http://localhost:11434/v1",
  // },
};
