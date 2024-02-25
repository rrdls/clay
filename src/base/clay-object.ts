import * as WEBIFC from "web-ifc";
import {Model} from "./model";

export abstract class ClayObject {
    model: Model;

    abstract ifcData: WEBIFC.IfcLineObject;
    
    abstract update(): void;

    protected constructor(model: Model) {
        this.model = model;
    }
}