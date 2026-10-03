import definition from "../../../fixtures/source-first-request/plugin.ts";
import { prepareWorkersRequestPlugin } from "../../lenso-workers-runtime/plugin.mjs";
import type { LifecycleContext } from "../src/authoring.ts";

declare const lifecycle: LifecycleContext;
const prepared = prepareWorkersRequestPlugin(definition, {
  providedEndpoints: definition.providers.map(value => value.descriptor),
  dependencies: { upstream: [] },
  configuration: { prefix: "typed" },
  lifecycle,
});
prepared.then(instance => instance.stop(lifecycle));
// @ts-expect-error A finite Host-owned lifecycle context is mandatory.
prepareWorkersRequestPlugin(definition, { providedEndpoints: [] });
