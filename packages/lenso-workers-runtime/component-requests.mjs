import { admitWorkersComponent, boundedJson } from "./component-admission.mjs";

/**
 * Admit one selected, dependency-free Component's JSON Request ABI for a
 * Workers event Host. This is not a Kernel runner or a Workers App builder.
 * The Host still owns verified artifact selection and HTTP ingress policy.
 */
export function createWorkersComponentRequestAdapter({
  plan, instanceKey, coreModule, instantiate, coreModulePath,
  expectedDescriptorDigests,
} = {}) {
  const admitted = admitWorkersComponent({
    plan, instanceKey, coreModule, instantiate, coreModulePath,
    expectedDescriptorDigests, guestExports: ["describe", "invoke"],
  });
  return Object.freeze({
    invoke(capability, operation, requestJson) {
      if (!admitted.selected.get(capability)?.has(operation))
        throw new TypeError("Capability Operation was not selected by the Plan");
      boundedJson(requestJson, "Guest request");
      return boundedJson(admitted.freshGuest().invoke(capability, operation, requestJson),
        "Guest response");
    },
  });
}
