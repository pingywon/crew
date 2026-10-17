import { route } from "./router.js";
import { mockModel } from "./crew/mock.js";

export default {
  async fetch(request, env, ctx) {
    const handled = await route(request, env, ctx, env.MOCK_ENGINE === "1" ? { model: mockModel } : {});
    if (handled) return handled;
    return env.ASSETS.fetch(request);
  },
};
