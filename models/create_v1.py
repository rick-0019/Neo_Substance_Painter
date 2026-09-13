import bpy
import bmesh
import math
from mathutils import Vector, Euler

# Limpiar escena
bpy.ops.wm.read_factory_settings(use_empty=True)

# Crear material básico
mat = bpy.data.materials.new(name="V1_Papercraft")
mat.use_nodes = True

# Colección de objetos que conformarán la V-1
parts = []

# ==============================================================================
# 1. FUSELAJE CENTRAL (Cilindro horizontal a lo largo del eje Y)
#    Y positivo = Hacia adelante (nariz), Y negativo = Hacia atrás (cola)
#    Z = Arriba, X = Alas (izq / der)
# ==============================================================================
# Diámetro: 0.8m (radio 0.4m), Longitud cilíndrica: 3.2m
bpy.ops.mesh.primitive_cylinder_add(
    vertices=16,
    radius=0.4,
    depth=3.2,
    location=(0, 0, 0),
    rotation=(math.radians(90), 0, 0)
)
body = bpy.context.active_object
body.name = "Fuselage_Center"
parts.append(body)

# ==============================================================================
# 2. OJIVA FRONTAL / NARIZ (Cono que cierra la punta delantera)
# ==============================================================================
# Base radio 0.4, altura 1.4m, ubicada en Y = 1.6 + 0.7 = 2.3
bpy.ops.mesh.primitive_cone_add(
    vertices=16,
    radius1=0.4,
    radius2=0.06,  # Punta ligeramente redondeada / truncada típica de papel
    depth=1.4,
    location=(0, 2.3, 0),
    rotation=(math.radians(-90), 0, 0)
)
nose = bpy.context.active_object
nose.name = "Fuselage_Nose"
parts.append(nose)

# Punta redondeada extrema
bpy.ops.mesh.primitive_cone_add(
    vertices=16,
    radius1=0.06,
    radius2=0.0,
    depth=0.15,
    location=(0, 3.075, 0),
    rotation=(math.radians(-90), 0, 0)
)
nose_tip = bpy.context.active_object
nose_tip.name = "Fuselage_Tip"
parts.append(nose_tip)

# ==============================================================================
# 3. CONO DE COLA TRASERO (Cono truncado hacia atrás)
# ==============================================================================
# Base radio 0.4, se afina a 0.18m, longitud 1.8m. Ubicado en Y = -1.6 - 0.9 = -2.5
bpy.ops.mesh.primitive_cone_add(
    vertices=16,
    radius1=0.4,
    radius2=0.18,
    depth=1.8,
    location=(0, -2.5, 0),
    rotation=(math.radians(90), 0, 0)
)
tail = bpy.context.active_object
tail.name = "Fuselage_Tail"
parts.append(tail)

# Tapa trasera de cola
bpy.ops.mesh.primitive_cylinder_add(
    vertices=16,
    radius=0.18,
    depth=0.1,
    location=(0, -3.45, 0),
    rotation=(math.radians(90), 0, 0)
)
tail_cap = bpy.context.active_object
tail_cap.name = "Tail_Cap"
parts.append(tail_cap)

# ==============================================================================
# 4. MOTOR PULSORREACTOR (Argus As 014) montado en la parte superior trasera
# ==============================================================================
# Tubo principal del motor (cilindro radio 0.22m, longitud 2.8m, centro en Z = 0.72, Y = -2.0)
bpy.ops.mesh.primitive_cylinder_add(
    vertices=16,
    radius=0.22,
    depth=2.8,
    location=(0, -2.0, 0.72),
    rotation=(math.radians(90), 0, 0)
)
engine_body = bpy.context.active_object
engine_body.name = "Engine_Body"
parts.append(engine_body)

# Admisión frontal del motor (cono corto ensanchado adelante)
bpy.ops.mesh.primitive_cone_add(
    vertices=16,
    radius1=0.26,
    radius2=0.22,
    depth=0.4,
    location=(0, -0.4, 0.72),
    rotation=(math.radians(90), 0, 0)
)
engine_intake = bpy.context.active_object
engine_intake.name = "Engine_Intake"
parts.append(engine_intake)

# Tobera de escape trasera afinada
bpy.ops.mesh.primitive_cone_add(
    vertices=16,
    radius1=0.22,
    radius2=0.19,
    depth=0.6,
    location=(0, -3.7, 0.72),
    rotation=(math.radians(-90), 0, 0)
)
engine_exhaust = bpy.context.active_object
engine_exhaust.name = "Engine_Exhaust"
parts.append(engine_exhaust)

# Soporte vertical / pilón que une el fuselaje con el motor
bpy.ops.mesh.primitive_cube_add(
    size=1.0,
    location=(0, -1.8, 0.45)
)
pylon = bpy.context.active_object
pylon.scale = (0.08, 0.6, 0.28)
bpy.ops.object.transform_apply(scale=True)
pylon.name = "Engine_Pylon"
parts.append(pylon)

# ==============================================================================
# 5. ALAS PRINCIPALES RECTAS (Típico perfil V-1 / papercraft)
#    Envergadura: 4.8m (X = -2.4 a +2.4), Cuerda: 1.0m, Espesor delgado: 0.08m
# ==============================================================================
bpy.ops.mesh.primitive_cube_add(
    size=1.0,
    location=(0, 0.5, 0.0)
)
wings = bpy.context.active_object
wings.scale = (4.8, 1.0, 0.08)
bpy.ops.object.transform_apply(scale=True)
wings.name = "Wings"
parts.append(wings)

# ==============================================================================
# 6. ESTABILIZADORES DE COLA (Vertical y Horizontales)
# ==============================================================================
# Estabilizador vertical (Timón inferior que conecta con fuselaje y motor)
bpy.ops.mesh.primitive_cube_add(
    size=1.0,
    location=(0, -3.0, 0.38)
)
tail_vertical = bpy.context.active_object
tail_vertical.scale = (0.06, 0.7, 0.55)
bpy.ops.object.transform_apply(scale=True)
tail_vertical.name = "Tail_Vertical"
parts.append(tail_vertical)

# Estabilizadores horizontales traseros
bpy.ops.mesh.primitive_cube_add(
    size=1.0,
    location=(0, -2.9, 0.05)
)
tail_horizontal = bpy.context.active_object
tail_horizontal.scale = (1.8, 0.6, 0.06)
bpy.ops.object.transform_apply(scale=True)
tail_horizontal.name = "Tail_Horizontal"
parts.append(tail_horizontal)

# ==============================================================================
# 7. UNIFICAR PIEZAS Y REALIZAR DESENROLLADO UV ÓPTIMO PARA PAPERCRAFT
# ==============================================================================
# Seleccionar todas las partes
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

# ==============================================================================
# 8. MARCADO INTELIGENTE DE COSTURAS (SEAMS) Y DESENROLLADO UV DE PAPEL
# ==============================================================================
# Entrar a modo edición con BMesh
bpy.ops.object.mode_set(mode='EDIT')
bm = bmesh.from_edit_mesh(v1_model.data)

# Seleccionar todas las caras y usar Unwrap con costuras angulares automáticas
bpy.ops.mesh.select_all(action='SELECT')

# Smart Project para desplegar todas las facetas planas y curvas sin estiramiento
# margin=0.025 garantiza que cada solapa/pieza tenga separación suficiente en 2048px
bpy.ops.uv.smart_project(
    angle_limit=math.radians(66.0),
    island_margin=0.025,
    area_weight=0.0,
    correct_aspect=True,
    scale_to_bounds=False
)

# Empacar islas para aprovechar al máximo el espacio UV cuadrado [0, 1]
bpy.ops.uv.pack_islands(margin=0.025)

bmesh.update_edit_mesh(v1_model.data)
bpy.ops.object.mode_set(mode='OBJECT')

# Suavizado suave de normales
for poly in v1_model.data.polygons:
    poly.use_smooth = True

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

print("¡PROCESO COMPLETADO CON ÉXITO!")
