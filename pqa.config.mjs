export default {
  llm: {
    provider: "fireworks",
    model: "accounts/fireworks/models/deepseek-v4-flash",
    thinking: {
      enabled: true,
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
