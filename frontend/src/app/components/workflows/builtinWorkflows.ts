import { BUILT_IN_WORKFLOWS_PART_FOUR } from "./builtinWorkflows/partFour";
import { BUILT_IN_WORKFLOWS_PART_ONE } from "./builtinWorkflows/partOne";
import { BUILT_IN_WORKFLOWS_PART_THREE } from "./builtinWorkflows/partThree";
import { BUILT_IN_WORKFLOWS_PART_TWO } from "./builtinWorkflows/partTwo";

export const BUILT_IN_WORKFLOWS = [
  ...BUILT_IN_WORKFLOWS_PART_ONE,
  ...BUILT_IN_WORKFLOWS_PART_TWO,
  ...BUILT_IN_WORKFLOWS_PART_THREE,
  ...BUILT_IN_WORKFLOWS_PART_FOUR,
];

export const BUILT_IN_IDS = new Set(BUILT_IN_WORKFLOWS.map((wf) => wf.id));
