// Render the kernel's scatter output as InstancedMesh objects.
// Every type gets one InstancedMesh — thousands of instances = one draw call.

import * as THREE from 'three';
import { SCATTER_TYPES, generateScatter } from '../kernel/index.js';

// Base geometries per scatter type. Lightweight — faceted, low-poly.
function geomForType(type) {
  switch (type) {
    case SCATTER_TYPES.ROCK_SMALL: {
      const g = new THREE.DodecahedronGeometry(1.2, 0);
      g.scale(1, 0.7, 1);
      return g;
    }
    case SCATTER_TYPES.ROCK_LARGE: {
      const g = new THREE.DodecahedronGeometry(3.5, 0);
      g.scale(1.2, 0.8, 1.1);
      return g;
    }
    case SCATTER_TYPES.TREE_CONIFER: {
      // Cone on a trunk
      const trunk = new THREE.CylinderGeometry(0.25, 0.35, 2, 6);
      trunk.translate(0, 1, 0);
      const foliage = new THREE.ConeGeometry(2, 7, 8);
      foliage.translate(0, 5.5, 0);
      return mergeGeoms([trunk, foliage]);
    }
    case SCATTER_TYPES.TREE_BROAD: {
      const trunk = new THREE.CylinderGeometry(0.3, 0.4, 2.5, 6);
      trunk.translate(0, 1.25, 0);
      const top = new THREE.IcosahedronGeometry(2.5, 0);
      top.translate(0, 4.5, 0);
      return mergeGeoms([trunk, top]);
    }
    case SCATTER_TYPES.GRASS_TUFT: {
      const g = new THREE.ConeGeometry(0.4, 1.2, 4);
      g.translate(0, 0.6, 0);
      return g;
    }
    case SCATTER_TYPES.ICE_SHARD: {
      const g = new THREE.ConeGeometry(1.5, 6, 5);
      g.translate(0, 3, 0);
      return g;
    }
    case SCATTER_TYPES.LAVA_SPIRE: {
      const g = new THREE.ConeGeometry(2, 8, 6);
      g.translate(0, 4, 0);
      return g;
    }
    case SCATTER_TYPES.CACTUS: {
      const main = new THREE.CylinderGeometry(0.6, 0.7, 4, 6);
      main.translate(0, 2, 0);
      const arm = new THREE.CylinderGeometry(0.3, 0.35, 1.5, 6);
      arm.rotateZ(Math.PI / 2);
      arm.translate(1, 2.5, 0);
      return mergeGeoms([main, arm]);
    }
  }
  return new THREE.BoxGeometry(1, 1, 1);
}

function mergeGeoms(geoms) {
  // Simple manual merge — Three r128 doesn't ship BufferGeometryUtils by default.
  const positionArrays = [];
  const normalArrays = [];
  let totalCount = 0;
  for (const g of geoms) {
    const p = g.attributes.position;
    positionArrays.push(p.array);
    g.computeVertexNormals();
    normalArrays.push(g.attributes.normal.array);
    totalCount += p.count;
  }
  const merged = new THREE.BufferGeometry();
  const pos = new Float32Array(totalCount * 3);
  const nrm = new Float32Array(totalCount * 3);
  let offset = 0;
  for (let i = 0; i < positionArrays.length; i++) {
    pos.set(positionArrays[i], offset);
    nrm.set(normalArrays[i], offset);
    offset += positionArrays[i].length;
  }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return merged;
}

function baseColorForType(type) {
  switch (type) {
    case SCATTER_TYPES.ROCK_SMALL:   return new THREE.Color(0.35, 0.32, 0.3);
    case SCATTER_TYPES.ROCK_LARGE:   return new THREE.Color(0.3, 0.28, 0.26);
    case SCATTER_TYPES.TREE_CONIFER: return new THREE.Color(0.12, 0.3, 0.15);
    case SCATTER_TYPES.TREE_BROAD:   return new THREE.Color(0.25, 0.42, 0.18);
    case SCATTER_TYPES.GRASS_TUFT:   return new THREE.Color(0.3, 0.5, 0.2);
    case SCATTER_TYPES.ICE_SHARD:    return new THREE.Color(0.75, 0.88, 0.98);
    case SCATTER_TYPES.LAVA_SPIRE:   return new THREE.Color(0.2, 0.1, 0.08);
    case SCATTER_TYPES.CACTUS:       return new THREE.Color(0.25, 0.4, 0.2);
  }
  return new THREE.Color(0.5, 0.5, 0.5);
}

/**
 * Build instanced meshes for every scatter type in a region.
 * Returns an array of THREE.InstancedMesh ready to add to the scene.
 */
export function buildSurfaceScatter(planet, minX, minZ, maxX, maxZ) {
  const instances = generateScatter(planet, minX, minZ, maxX, maxZ);
  if (instances.length === 0) return [];

  // Bucket by type
  const buckets = {};
  for (const inst of instances) {
    (buckets[inst.type] ||= []).push(inst);
  }

  const meshes = [];
  const dummy = new THREE.Object3D();

  for (const type in buckets) {
    const list = buckets[type];
    const geom = geomForType(type);
    const mat = new THREE.MeshStandardMaterial({
      color: baseColorForType(type),
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });
    // Glowing for lava spires
    if (type === SCATTER_TYPES.LAVA_SPIRE) {
      mat.emissive = new THREE.Color(0.6, 0.1, 0.02);
      mat.emissiveIntensity = 0.6;
    }

    const mesh = new THREE.InstancedMesh(geom, mat, list.length);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    for (let i = 0; i < list.length; i++) {
      const inst = list[i];
      dummy.position.set(inst.x, inst.y, inst.z);
      dummy.rotation.set(0, inst.rotation, 0);
      dummy.scale.setScalar(inst.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    meshes.push(mesh);
  }
  return meshes;
}
