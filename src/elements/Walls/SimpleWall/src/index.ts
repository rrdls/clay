import * as THREE from "three";
import * as FRAGS from "bim-fragment";
import { v4 as uuidv4 } from "uuid";
import { IFC4X3 as IFC } from "web-ifc";
import { Model } from "../../../../base";
import { IfcUtils } from "../../../../utils/ifc-utils";
import { Element } from "../../../Elements";
import { Extrusion, HalfSpace, RectangleProfile } from "../../../../geometries";
import { SimpleWallType } from "../index";
import { SimpleOpening } from "../../../Openings";
import { ClayGeometry } from "../../../../geometries/Geometry";

export class SimpleWall extends Element {
  attributes: IFC.IfcWall;

  type: SimpleWallType;

  body: Extrusion<RectangleProfile>;

  height = 3;

  startPoint = new THREE.Vector3(0, 0, 0);

  endPoint = new THREE.Vector3(1, 0, 0);

  private _openings = new Map<
    number,
    { opening: SimpleOpening; distance: number }
  >();

  get length() {
    return this.startPoint.distanceTo(this.endPoint);
  }

  get midPoint() {
    return new THREE.Vector3(
      (this.startPoint.x + this.endPoint.x) / 2,
      (this.startPoint.y + this.endPoint.y) / 2,
      (this.startPoint.z + this.endPoint.z) / 2
    );
  }

  get direction() {
    const vector = new THREE.Vector3();
    vector.subVectors(this.endPoint, this.startPoint);
    vector.normalize();
    return vector;
  }

  constructor(model: Model, type: SimpleWallType) {
    super(model, type);
    this.type = type;

    const profile = new RectangleProfile(model);
    this.body = new Extrusion(model, profile);
    const id = this.body.attributes.expressID;
    this.type.geometries.set(id, this.body);
    this.geometries.add(id);

    const placement = IfcUtils.localPlacement();
    const shape = IfcUtils.productDefinitionShape(model, [
      this.body.attributes,
    ]);

    this.attributes = new IFC.IfcWall(
      new IFC.IfcGloballyUniqueId(uuidv4()),
      null,
      null,
      null,
      null,
      placement,
      shape,
      null,
      null
    );

    this.model.set(this.attributes);
  }

  update(updateGeometry: boolean = false) {
    this.updateAllOpenings();

    const profile = this.body.profile;
    profile.dimension.x = this.length;
    profile.dimension.y = this.type.width;
    profile.update();

    this.body.depth = this.height;
    this.body.update();

    const dir = this.direction;
    this.rotation.z = Math.atan2(dir.y, dir.x);
    this.position = this.midPoint;

    const shape = this.model.get(this.attributes.Representation);
    const reps = this.model.get(shape.Representations[0]);
    reps.Items = [this.body.attributes];
    this.model.set(reps);
    this.updateGeometryID();
    super.update(updateGeometry);
  }

  extend(wall: SimpleWall, isEnd = true) {
    const zDirection = new THREE.Vector3(0, 0, 1);

    const normalVector = wall.direction.cross(zDirection);

    const correctNormalVector = new THREE.Vector3(
      normalVector.x,
      normalVector.z,
      normalVector.y * -1
    );

    const coplanarPoint = new THREE.Vector3(
      wall.startPoint.x,
      wall.startPoint.z,
      wall.startPoint.y * -1
    );

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      correctNormalVector,
      coplanarPoint
    );

    const correctDirection = new THREE.Vector3(
      this.direction.x * -1,
      this.direction.z,
      this.direction.y
    );

    if (isEnd) {
      correctDirection.negate();
    }

    const origin = isEnd ? this.endPoint : this.startPoint;
    const sign = isEnd ? -1 : 1;

    const rayOriginPoint = new THREE.Vector3(
      origin.x,
      origin.z,
      origin.y * sign
    );

    const rayAxisWall1 = new THREE.Ray(rayOriginPoint, correctDirection);

    const intersectionPoint = rayAxisWall1.intersectPlane(
      plane,
      new THREE.Vector3()
    );

    if (intersectionPoint) {
      const correctIntersectionPoint = new THREE.Vector3(
        intersectionPoint?.x,
        intersectionPoint?.z * -1,
        intersectionPoint?.y
      );

      if (isEnd) {
        this.endPoint = correctIntersectionPoint;
      } else {
        this.startPoint = correctIntersectionPoint;
      }

      this.update(true);
      wall.update(true);

      console.log("correctIntersectionPoint", correctIntersectionPoint);
      return correctIntersectionPoint;
    }
    return null;
  }

  addCorner(wall: SimpleWall, atTheEndPoint = true) {
    const intersectionPoint = this.extend(wall, atTheEndPoint);
    if (!intersectionPoint) return;

    const angle = wall.rotation.z - this.rotation.z;

    const angle2 = Math.asin(
      this.direction.dot(wall.direction) /
        (this.direction.length() * wall.direction.length())
    );

    let sign = 1;
    if ((angle2 < 0 && atTheEndPoint) || (angle2 > 0 && !atTheEndPoint)) {
      sign = -1;
    }

    const width1 = this.type.width;
    const width2 = this.type.width;
    const distance1 = this.midPoint.distanceTo(intersectionPoint);
    const distance2 = wall.midPoint.distanceTo(intersectionPoint);

    const halfSpace1 = new HalfSpace(this.model);
    halfSpace1.position.x = distance1 - width1 / (2 * Math.sin(angle));
    halfSpace1.rotation.y = angle;
    halfSpace1.rotation.x = Math.PI / 2;
    halfSpace1.update();

    const halfSpace2 = new HalfSpace(this.model);
    halfSpace2.position.x = sign * distance2 + width2 / (2 * Math.sin(angle));
    halfSpace2.rotation.y = angle;
    halfSpace2.rotation.x = -Math.PI / 2;
    halfSpace2.update();

    this.body.addSubtraction(halfSpace1);
    wall.body.addSubtraction(halfSpace2);
    wall.update(true);
    this.update(true);
  }

  addOpening(opening: SimpleOpening) {
    super.addOpening(opening);
    this.setOpening(opening);
    this.updateGeometryID();
  }

  removeOpening(opening: SimpleOpening) {
    super.removeOpening(opening);
    this._openings.delete(opening.attributes.expressID);
    this.updateGeometryID();
  }

  setOpening(opening: SimpleOpening) {
    const wallPlane = new THREE.Plane();

    const tempPoint = this.startPoint.clone();
    tempPoint.z += 1;
    wallPlane.setFromCoplanarPoints(tempPoint, this.startPoint, this.endPoint);
    const newPosition = new THREE.Vector3();
    wallPlane.projectPoint(opening.position, newPosition);

    opening.position.copy(newPosition);
    opening.update();

    // The distance is signed, so that it also supports openings that are
    // before the startPoint by using the dot product
    let distance = newPosition.distanceTo(this.startPoint);
    const vector = new THREE.Vector3();
    vector.subVectors(newPosition, this.startPoint);
    const dotProduct = vector.dot(this.direction);
    distance *= dotProduct > 0 ? 1 : -1;

    const id = opening.attributes.expressID;

    this._openings.set(id, { opening, distance });
  }

  private updateAllOpenings() {
    const start = this.startPoint;
    const dir = this.direction;
    for (const [_id, { opening, distance }] of this._openings) {
      const pos = dir.clone().multiplyScalar(distance).add(start);

      // Align opening to wall
      opening.position.x = pos.x;
      opening.position.y = pos.y;
      opening.rotation.z = this.rotation.z;

      opening.update();
    }
  }

  private updateGeometryID() {
    const modelID = this.model.modelID;
    const id = this.attributes.expressID;
    this.model.ifcAPI.StreamMeshes(modelID, [id], (ifcMesh) => {
      const newGeometry = ifcMesh.geometries.get(0);
      const newGeomID = newGeometry.geometryExpressID;
      const oldGeomID = this.geometries.values().next().value;

      this.geometries.clear();
      this.geometries.add(newGeomID);

      const frag = this.type.fragments.get(oldGeomID) as FRAGS.Fragment;
      this.type.fragments.delete(oldGeomID);
      this.type.fragments.set(newGeomID, frag);

      const geometry = this.type.geometries.get(oldGeomID) as ClayGeometry;
      this.type.geometries.delete(oldGeomID);
      this.type.geometries.set(newGeomID, geometry);
    });
  }
}
