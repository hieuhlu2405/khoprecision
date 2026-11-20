export type BlankMaterial = {
  id: string;
  code: string;
  specification: string;
  length_mm: number;
  width_mm: number;
  is_active: boolean;
};

export type BlankMaterialDetails = Pick<BlankMaterial, "specification" | "length_mm" | "width_mm">;
