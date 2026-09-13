import bpy
import bmesh
import math
from mathutils import Vector, Euler

# 1. Limpiar escena
bpy.ops.wm.read_factory_settings(use_empty=True)

# 2. Crear material básico
mat = bpy.data.materials.new(name="V1_Papercraft")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get('Principled BSDF')
if bsdf:
    bsdf.inputs['Roughness'].default_value = 0.8

parts = []

# ==============================================================================
# FUNCIONES AUXILIARES PARA CREAR Y DESPLEGAR PIEZAS PAPERCRAFT
# ==============================================================================

def create_paper_cylinder(name, radius, depth, location, rotation, vertices=16):
    """Crea un tubo cilíndrico sin tapas internas y con costura longitudinal en la panza."""
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        end_fill_type='NOTHING',
        location=location,
        rotation=rotation
    )
    obj = bpy.context.active_object
    obj.name = name

    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(obj.data)
    bm.edges.ensure_lookup_table()

    # Costura longitudinal a lo largo del cilindro en la parte inferior (panza)
    long_edges = [e for e in bm.edges if e.calc_length() > depth * 0.85]
    if long_edges:
        long_edges.sort(key=lambda e: (e.verts[0].co.z + e.verts[1].co.z))
        long_edges[0].seam = True

    bmesh.update_edit_mesh(obj.data)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method='ANGLE_BASED', margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    parts.append(obj)
    return obj


def create_paper_cone(name, r1, r2, depth, location, rotation, vertices=16):
    """Crea un cono o cono truncado sin tapas internas y con costura longitudinal."""
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=r1,
        radius2=r2,
        depth=depth,
        end_fill_type='NOTHING',
        location=location,
        rotation=rotation
    )
    obj = bpy.context.active_object
    obj.name = name

    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(obj.data)
    bm.edges.ensure_lookup_table()

    # Aristas longitudinales desde la base hacia la punta
    long_edges = [e for e in bm.edges if e.calc_length() > depth * 0.75]
    if long_edges:
        long_edges.sort(key=lambda e: (e.verts[0].co.z + e.verts[1].co.z))
        long_edges[0].seam = True

    bmesh.update_edit_mesh(obj.data)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method='ANGLE_BASED', margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    parts.append(obj)
    return obj


def create_paper_box(name, scale, location, rotation=(0, 0, 0)):
    """Crea un prisma rectangular (ala o timón) desplegable en una sola pieza doblada."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True, rotation=(rotation != (0, 0, 0)))

    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(obj.data)

    # Identificar la arista del borde de ataque (borde frontal de mayor longitud) para NO cortarla (es el pliegue)
    max_len = max(e.calc_length() for e in bm.edges)
    fold_edge_found = False

    for e in bm.edges:
        mid = (e.verts[0].co + e.verts[1].co) * 0.5
        length = e.calc_length()
        if not fold_edge_found and length > max_len * 0.9 and mid.y >= location[1]:
            fold_edge_found = True
            continue
        e.seam = True

    bmesh.update_edit_mesh(obj.data)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method='ANGLE_BASED', margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    parts.append(obj)
    return obj


# ==============================================================================
# CONSTRUCCIÓN DE LA BOMBA VOLADORA V-1
# ==============================================================================

# 1. Fuselaje Central (Cilindro principal)
body = create_paper_cylinder(
    name="Fuselage_Center",
    radius=0.4,
    depth=3.2,
    location=(0, 0, 0),
    rotation=(math.radians(90), 0, 0),
    vertices=16
)

# 2. Ojiva Delantera (Cono truncado)
nose = create_paper_cone(
    name="Fuselage_Nose",
    r1=0.4,
    r2=0.06,
    depth=1.4,
    location=(0, 2.3, 0),
    rotation=(math.radians(-90), 0, 0),
    vertices=16
)

# 3. Punta Extrema de Ojiva (Cono cerrado)
nose_tip = create_paper_cone(
    name="Fuselage_Tip",
    r1=0.06,
    r2=0.0,
    depth=0.15,
    location=(0, 3.075, 0),
    rotation=(math.radians(-90), 0, 0),
    vertices=16
)

# 4. Cono de Cola Trasero (Cono truncado hacia atrás)
tail = create_paper_cone(
    name="Fuselage_Tail",
    r1=0.4,
    r2=0.18,
    depth=1.8,
    location=(0, -2.5, 0),
    rotation=(math.radians(90), 0, 0),
    vertices=16
)

# 5. Tapa Trasera de Cola
bpy.ops.mesh.primitive_cylinder_add(
    vertices=16,
    radius=0.18,
    depth=0.02,
    location=(0, -3.4, 0),
    rotation=(math.radians(90), 0, 0)
)
tail_cap = bpy.context.active_object
tail_cap.name = "Tail_Cap"
bpy.ops.object.mode_set(mode='EDIT')
bm = bmesh.from_edit_mesh(tail_cap.data)
for e in bm.edges:
    e.seam = True
bmesh.update_edit_mesh(tail_cap.data)
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.unwrap(method='ANGLE_BASED', margin=0.02)
bpy.ops.object.mode_set(mode='OBJECT')
parts.append(tail_cap)

# 6. Motor Pulsorreactor Argus As 014
engine_body = create_paper_cylinder(
    name="Engine_Body",
    radius=0.22,
    depth=2.8,
    location=(0, -2.0, 0.72),
    rotation=(math.radians(90), 0, 0),
    vertices=16
)

engine_intake = create_paper_cone(
    name="Engine_Intake",
    r1=0.26,
    r2=0.22,
    depth=0.4,
    location=(0, -0.4, 0.72),
    rotation=(math.radians(90), 0, 0),
    vertices=16
)

engine_exhaust = create_paper_cone(
    name="Engine_Exhaust",
    r1=0.22,
    r2=0.19,
    depth=0.6,
    location=(0, -3.7, 0.72),
    rotation=(math.radians(-90), 0, 0),
    vertices=16
)

# 7. Pilón de soporte del motor
pylon = create_paper_box(
    name="Engine_Pylon",
    scale=(0.08, 0.6, 0.28),
    location=(0, -1.8, 0.45)
)

# 8. Alas Principales Rectas
wings = create_paper_box(
    name="Wings",
    scale=(4.8, 1.0, 0.08),
    location=(0, 0.5, 0.0)
)

# 9. Estabilizadores de Cola
tail_vertical = create_paper_box(
    name="Tail_Vertical",
    scale=(0.06, 0.7, 0.55),
    location=(0, -3.0, 0.38)
)

tail_horizontal = create_paper_box(
    name="Tail_Horizontal",
    scale=(1.8, 0.6, 0.06),
    location=(0, -2.9, 0.05)
)

# ==============================================================================
# UNIFICACIÓN FINAL Y EMPAQUE DE ISLAS PAPERCRAFT
# ==============================================================================
bpy.ops.object.select_all(action='DESELECT')
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = body

# Unir todo en una sola malla
bpy.ops.object.join()
v1_model = bpy.context.active_object
v1_model.name = "Bomba_V1"

# Aplicar transformaciones
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Asignar material
if len(v1_model.data.materials) == 0:
    v1_model.data.materials.append(mat)
else:
    v1_model.data.materials[0] = mat

# Empacar las islas de papercraft con margen generoso
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.pack_islands(margin=0.03)

# Flat shading para aspecto poligonal limpio de papel
bmesh_data = bmesh.from_edit_mesh(v1_model.data)
for f in bmesh_data.faces:
    f.smooth = False
bmesh.update_edit_mesh(v1_model.data)

bpy.ops.object.mode_set(mode='OBJECT')

# Guardar archivo .blend
blend_path = "c:/Proyectos varios/Neo_Substance_Painter/models/bomba_v1.blend"
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print(f"Archivo .blend guardado en: {blend_path}")

# Exportar como OBJ + MTL
obj_path = "c:/Proyectos varios/Neo_Substance_Painter/models/bomba_v1.obj"
try:
    bpy.ops.wm.obj_export(
        filepath=obj_path,
        export_materials=True,
        export_uv=True,
        export_normals=True,
        apply_modifiers=True
    )
    print(f"Exportación OBJ completada (wm.obj_export): {obj_path}")
except Exception as e:
    print("Fallback a export_scene.obj:", e)
    bpy.ops.export_scene.obj(
        filepath=obj_path,
        use_materials=True,
        use_uvs=True,
        use_normals=True
    )

print("¡PROCESO PAPERCRAFT COMPLETADO CON ÉXITO!")
