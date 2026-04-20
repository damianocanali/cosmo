// Multiverse branching: a child universe is its parent with one constant tweaked.
// Pure functions over plain data. No imports beyond the kernel.

import { generateUniverse } from './physics.js';

export function branchUniverse(parent, key, newValue) {
  const newConstants = { ...parent.constants, [key]: newValue };
  const childId = `${parent.id}→${key}=${newValue.toFixed(2)}`;
  return generateUniverse(newConstants, childId);
}

// Tree node helpers — keep state out of the kernel layer.
export function makeRoot(constants) {
  return {
    universe: generateUniverse(constants, 'ROOT'),
    parentId: null,
    childIds: [],
    branchedOn: null,
    depth: 0,
  };
}

export function makeChildNode(parent, child, branchedOn) {
  return {
    universe: child,
    parentId: parent.universe.id,
    childIds: [],
    branchedOn,
    depth: parent.depth + 1,
  };
}
