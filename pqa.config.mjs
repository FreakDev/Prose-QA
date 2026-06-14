export default {
  llm: {
    provider: "fireworks",
    model: "accounts/fireworks/models/deepseek-v4-flash",
    thinking: {
      enabled: true,
    },
  },
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
  //   provider: "ollama",
  //   model: "gemma4:12b-it-qat",
  // },
};
