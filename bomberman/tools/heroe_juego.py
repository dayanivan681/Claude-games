import bpy
import math
import random
from pathlib import Path
from mathutils import Vector

# =========================================================
# CONFIGURACIÓN
# =========================================================

import os
CARPETA = Path(os.environ.get("HEROE_OUT", str(Path.home() / "Bomba_Render")))
NOMBRE = "heroe"
ALTO = 700
MUESTRAS = 24
FONDO_TRANSPARENTE = False

CARPETA.mkdir(parents=True, exist_ok=True)
random.seed(219)

# =========================================================
# ESCENA
# =========================================================

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

for mat in list(bpy.data.materials):
    bpy.data.materials.remove(mat)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = MUESTRAS
scene.cycles.use_denoising = False

scene.render.threads_mode = "FIXED"
scene.render.threads = 8
scene.render.resolution_x = round(ALTO * 6 / 7)
scene.render.resolution_y = ALTO
scene.render.resolution_percentage = 100

scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = FONDO_TRANSPARENTE
scene.view_settings.view_transform = "AgX"

if scene.world is None:
    scene.world = bpy.data.worlds.new("Mundo")

scene.world.use_nodes = True
background = scene.world.node_tree.nodes["Background"]
background.inputs["Color"].default_value = (.65, .77, .8, 1)
background.inputs["Strength"].default_value = .45

model = bpy.data.collections.new("PERSONAJE")
studio = bpy.data.collections.new("ESTUDIO")
scene.collection.children.link(model)
scene.collection.children.link(studio)

active_collection = model
head_parent = None

# =========================================================
# MATERIALES
# =========================================================

def material(name, color, roughness=.3, metal=0, coat=.2, emission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, 1)

    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metal
    shader.inputs["Coat Weight"].default_value = coat
    shader.inputs["Coat Roughness"].default_value = .19

    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = emission

    return mat


white = material(
    "Casco blanco", (.93, .95, .92), .23, coat=.32
)
suit = material(
    "Traje blanco", (.89, .9, .87), .44, coat=.08
)
skin = material(
    "Rostro melocotón", (.72, .47, .27), .46, coat=.07
)
skin.node_tree.nodes["Principled BSDF"].inputs[
    "Subsurface Weight"
].default_value = .055

pink = material(
    "Rosa brillante", (.93, .055, .43), .23, coat=.45
)
pink_dark = material(
    "Costuras rosas", (.62, .025, .22), .3
)
lilac = material(
    "Lavanda", (.49, .35, .74), .5, coat=.05
)
blue = material(
    "Chaqueta azul", (.022, .1, .21), .62, coat=.02
)
blue_seam = material(
    "Costuras azules", (.06, .19, .31), .7, coat=0
)
black = material(
    "Ojos negros", (.004, .003, .002), .17, coat=.3
)
brows = material(
    "Cejas negras", (.008, .009, .01), .48, coat=0
)
belt_mat = material(
    "Cuero del cinturón", (.012, .014, .017), .38, coat=.08
)
gold = material(
    "Latón", (.65, .44, .14), .23, .82
)
bomb_mat = material(
    "Acero envejecido", (.065, .079, .082), .32, .82
)
socket_mat = material(
    "Cuello de hierro", (.034, .042, .045), .3, .75
)
rope = material(
    "Cuerda dorada", (.42, .28, .075), .73, coat=0
)
rope_light = material(
    "Fibras claras", (.62, .46, .16), .71, coat=0
)
ember = material(
    "Ascua naranja", (1, .15, .012), .25, emission=8
)
spark_white = material(
    "Chispa blanca", (1, .89, .54), .22, emission=18
)
spark_gold = material(
    "Chispa dorada", (1, .52, .09), .24, emission=5
)
backdrop = material(
    "Fondo verde agua", (.35, .63, .62),
    .82, coat=0, emission=.28
)


def microtexture(mat, scale, strength, distance):
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    texture = nodes.new("ShaderNodeTexNoise")
    texture.inputs["Scale"].default_value = scale
    texture.inputs["Detail"].default_value = 2

    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = distance

    links.new(texture.outputs["Fac"], bump.inputs["Height"])
    links.new(
        bump.outputs["Normal"],
        nodes["Principled BSDF"].inputs["Normal"]
    )



nodes = bomb_mat.node_tree.nodes
links = bomb_mat.node_tree.links

noise = nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 8
noise.inputs["Detail"].default_value = 5

ramp = nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = .2
ramp.color_ramp.elements[0].color = (.016, .024, .027, 1)
ramp.color_ramp.elements[1].position = .8
ramp.color_ramp.elements[1].color = (.16, .18, .15, 1)

links.new(noise.outputs["Fac"], ramp.inputs[0])
links.new(
    ramp.outputs[0],
    nodes["Principled BSDF"].inputs["Base Color"]
)

# =========================================================
# FUNCIONES PARA MODELAR
# =========================================================

def finish(obj, name, mat=None, smooth=True):
    obj.name = name

    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)

    active_collection.objects.link(obj)

    if mat:
        obj.data.materials.append(mat)

    if smooth and obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True

    if head_parent:
        bpy.context.view_layer.update()
        obj.parent = head_parent
        obj.matrix_parent_inverse = (
            head_parent.matrix_world.inverted()
        )

    return obj


def sphere(name, pos, scale, mat, rotation=None):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=28,
        ring_count=16,
        location=pos
    )
    obj = bpy.context.object
    obj.scale = scale

    if rotation:
        obj.rotation_euler = rotation

    return finish(obj, name, mat)


def box(name, pos, size, mat, bevel=.06, rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.dimensions = size

    bpy.ops.object.transform_apply(
        location=False,
        rotation=False,
        scale=True
    )

    if rotation:
        obj.rotation_euler = rotation

    modifier = obj.modifiers.new("Bordes redondeados", "BEVEL")
    modifier.width = bevel
    modifier.segments = 3
    obj.modifiers.new("Normales ponderadas", "WEIGHTED_NORMAL")

    return finish(obj, name, mat)


def mesh(name, vertices, faces, mat, sub=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()

    obj = bpy.data.objects.new(name, data)
    active_collection.objects.link(obj)
    finish(obj, name, mat)

    if sub:
        modifier = obj.modifiers.new(
            "Superficie suave", "SUBSURF"
        )
        modifier.levels = sub

    return obj


def tube(name, points, radius, mat, radii=None, poly=False):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 8
    data.bevel_depth = radius
    data.bevel_resolution = 2
    data.use_fill_caps = True

    spline = data.splines.new("POLY" if poly else "BEZIER")

    if poly:
        spline.points.add(len(points) - 1)

        for i, (point, coordinate) in enumerate(
            zip(spline.points, points)
        ):
            point.co = (*coordinate, 1)
            if radii:
                point.radius = radii[i]
    else:
        spline.bezier_points.add(len(points) - 1)

        for i, (point, coordinate) in enumerate(
            zip(spline.bezier_points, points)
        ):
            point.co = coordinate
            point.handle_left_type = "AUTO"
            point.handle_right_type = "AUTO"

            if radii:
                point.radius = radii[i]

    obj = bpy.data.objects.new(name, data)
    active_collection.objects.link(obj)
    data.materials.append(mat)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")

    return finish(bpy.context.object, name)


def cylinder_between(
    name, start, end, radius, mat, bevel=.02
):
    a = Vector(start)
    b = Vector(end)
    delta = b - a

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=24,
        radius=radius,
        depth=delta.length,
        location=(a + b) / 2
    )

    obj = bpy.context.object
    obj.rotation_euler = delta.to_track_quat(
        "Z", "Y"
    ).to_euler()

    if bevel:
        modifier = obj.modifiers.new("Borde torneado", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        obj.modifiers.new("Normales", "WEIGHTED_NORMAL")

    return finish(obj, name, mat)


def torus(
    name, pos, major, minor, mat,
    normal=(0, 0, 1), scale=None
):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=32,
        minor_segments=8,
        location=pos
    )

    obj = bpy.context.object
    obj.rotation_euler = Vector(normal).to_track_quat(
        "Z", "Y"
    ).to_euler()

    if scale:
        obj.scale = scale

    return finish(obj, name, mat)


def signed_power(value, power):
    return math.copysign(abs(value) ** power, value)

# =========================================================
# PIVOTES PARA ANIMAR (juego)
# =========================================================
# Nodos vacíos: Cuerpo (cadera) → PiernaI/PiernaD (cadera), BrazoI/BrazoD (hombro), Cabeza → Antena.
PIV = {}
def pivot(name, pos, parent=None):
    e = bpy.data.objects.new(name, None)
    model.objects.link(e)
    e.location = pos
    if parent:
        bpy.context.view_layer.update()
        e.parent = parent
        e.matrix_parent_inverse = parent.matrix_world.inverted()
    bpy.context.view_layer.update()
    PIV[name] = e
    return e

root = pivot("Heroe", (0, 0, 0))
body = pivot("Cuerpo", (0, .03, 2.3), root)
pivot("PiernaI", (-.27, .02, 2.25), body)
pivot("PiernaD", (.27, .02, 2.25), body)
pivot("BrazoI", (-.43, .02, 3.38), body)
pivot("BrazoD", (.43, .02, 3.38), body)

# =========================================================
# BOTAS Y PIERNAS (pose neutral)
# =========================================================
for side, sx in [("PiernaI", -1), ("PiernaD", 1)]:
    head_parent = PIV[side]
    x, y, angle = sx * .36, -.045, sx * .06
    box("Suela blanca", (x, y - .21, .105), (.88, 1.13, .16), suit, .12, rotation=(0, 0, angle))
    sphere("Empeine rosa", (x, y - .12, .36), (.43, .53, .27), pink, rotation=(0, 0, angle))
    sphere("Puntera brillante", (x, y - .43, .32), (.42, .36, .27), pink, rotation=(0, 0, angle))
    sphere("Caña de la bota", (x, y + .08, .57), (.29, .3, .35), pink)
    torus("Borde acolchado", (x, y + .07, .79), .265, .09, pink, scale=(1, 1, 1.22))
    sphere("Interior de la bota", (x, y + .07, .79), (.20, .20, .04), pink_dark)
    tube("Costura del empeine", [(x - .29, y - .12, .48), (x, y - .16, .57), (x + .29, y - .12, .48)], .013, pink_dark)
    tube("Pierna", [(sx * .27, .02, 2.25), (sx * .33, -.01, 1.52), (sx * .36, .02, .79)], .18, suit, [1.32, 1.0, .83])
    if sx > 0:
        band_a = Vector((.285, .01, 2.11))
        band_b = Vector((.305, -.005, 1.8))
        cylinder_between("Banda lavanda del muslo", band_a, band_b, .218, lilac, .055)
        axis = (band_b - band_a).normalized()
        for t in [.26, .70]:
            center = band_a.lerp(band_b, t)
            cylinder_between("Raya blanca del muslo", center - axis * .025, center + axis * .025, .223, suit, .012)

head_parent = body
sphere("Cadera", (0, .04, 2.28), (.48, .33, .4), suit)
head_parent = body
# TORSO Y CHAQUETA
# =========================================================

sphere(
    "Camiseta lavanda",
    (0, .045, 3.015),
    (.48, .31, .64),
    lilac
)

cylinder_between(
    "Cuello blanco",
    (0, .02, 3.45),
    (0, .02, 3.86),
    .23, suit, .05
)

rings = [
    (2.68, .49, .32, .42),
    (2.73, .51, .325, .43),
    (3.12, .47, .335, .36),
    (3.45, .43, .30, .26),
    (3.57, .31, .25, .32)
]

vertices = []
faces = []
columns = 40

for z, rx, ry, gap in rings:
    for i in range(columns):
        angle = gap + (math.tau - 2 * gap) * i / (columns - 1)

        vertices.append((
            math.sin(angle) * rx,
            -math.cos(angle) * ry + .045,
            z
        ))

for j in range(len(rings) - 1):
    for i in range(columns - 1):
        a = j * columns + i
        faces.append((
            a, a + 1,
            a + columns + 1,
            a + columns
        ))

jacket = mesh(
    "Chaqueta azul",
    vertices, faces,
    blue, 1
)

modifier = jacket.modifiers.new("Grosor de tela", "SOLIDIFY")
modifier.thickness = .055

for sign in [-1, 1]:
    tube(
        "Borde delantero de chaqueta",
        [
            (sign * .205, -.245, 2.70),
            (sign * .195, -.278, 3.03),
            (sign * .115, -.245, 3.46)
        ],
        .022, blue_seam
    )

    tube(
        "Dobladillo de chaqueta",
        [
            (sign * .215, -.25, 2.70),
            (sign * .42, -.17, 2.69),
            (sign * .49, .04, 2.71)
        ],
        .014, blue_seam
    )

    collar = mesh(
        "Solapa",
        [
            (sign * .06, -.21, 3.56),
            (sign * .23, -.25, 3.56),
            (sign * .29, -.28, 3.34),
            (sign * .12, -.3, 3.43)
        ],
        [(0, 1, 2, 3)],
        blue
    )

    modifier = collar.modifiers.new("Tela doble", "SOLIDIFY")
    modifier.thickness = .04

    modifier = collar.modifiers.new("Esquinas suaves", "BEVEL")
    modifier.width = .025
    modifier.segments = 3

# =========================================================
# CINTURÓN
# =========================================================

sphere(
    "Correa negra",
    (0, .02, 2.56),
    (.52, .352, .17),
    belt_mat
)

box(
    "Fondo de hebilla",
    (0, -.352, 2.56),
    (.44, .09, .4),
    belt_mat, .065
)

for x in [-.235, .235]:
    box(
        "Lateral de hebilla",
        (x, -.412, 2.56),
        (.085, .105, .45),
        gold, .035
    )

for z in [2.365, 2.755]:
    box(
        "Travesaño de hebilla",
        (0, -.412, z),
        (.48, .105, .07),
        gold, .03
    )

box(
    "Lengüeta de hebilla",
    (-.035, -.43, 2.56),
    (.036, .043, .27),
    gold, .015
)

# =========================================================
head_parent = None

# =========================================================
# BRAZOS (pose neutral, espejados del brazo derecho original)
# =========================================================
for side, sx in [("BrazoI", -1), ("BrazoD", 1)]:
    head_parent = PIV[side]
    m = lambda p: (sx * p[0], p[1], p[2])
    tube("Brazo", [m((.43, .025, 3.38)), m((.7, .005, 3.06)), m((.78, -.14, 2.74))], .13, suit, [1.0, .9, .85])
    cylinder_between("Manga", m((.44, .02, 3.41)), m((.58, .01, 3.2)), .205, blue, .055)
    if sx > 0:
        cylinder_between("Banda lavanda del brazo", m((.60, .005, 3.18)), m((.65, .002, 3.07)), .133, lilac, .02)
    cylinder_between("Muñequera", m((.78, -.14, 2.77)), m((.82, -.17, 2.48)), .265, pink, .065)
    torus("Borde superior del guante", m((.78, -.14, 2.77)), .239, .034, pink, normal=(sx * .1, -.05, 1))
    torus("Costura del guante", m((.82, -.17, 2.47)), .25, .025, pink_dark, normal=(sx * .1, -.05, 1))
    sphere("Mano", m((.84, -.21, 2.22)), (.30, .265, .37), pink, rotation=(0, sx * -.09, sx * .04))
    sphere("Pulgar", m((.61, -.365, 2.29)), (.13, .16, .21), pink, rotation=(.15, sx * -.35, sx * .2))
    for j in range(3):
        x = .71 + j * .13
        tube("Pliegue del guante", [m((x, -.443, 2.08)), m((x + .015, -.464, 2.13))], .009, pink_dark)
head_parent = body
# CASCO Y ROSTRO
# =========================================================

head_parent = pivot("Cabeza", (0, 0, 4.83), body)

# Radio X, radio Z, centro Z, profundidad Y.
helmet_rings = [
    (.835, .765, 4.76, -.83),
    (.87, .80, 4.76, -.91),
    (.95, .9, 4.82, -.88),
    (1.075, 1.06, 4.90, -.66),
    (1.13, 1.13, 4.92, -.28),
    (1.105, 1.11, 4.92, .12),
    (.96, 1.0, 4.93, .50),
    (.68, .75, 4.94, .78),
    (.22, .3, 4.94, .90),
    (.015, .02, 4.94, .92)
]

vertices = []
faces = []
segments = 48

for rx, rz, cz, y in helmet_rings:
    for i in range(segments):
        angle = math.tau * i / segments

        x = rx * signed_power(math.cos(angle), .72)
        z = cz + rz * signed_power(math.sin(angle), .72)

        vertices.append((x, y, z))

for j in range(len(helmet_rings) - 1):
    for i in range(segments):
        a = j * segments + i
        b = j * segments + (i + 1) % segments
        faces.append((a, b, b + segments, a + segments))

faces.append(tuple(
    (len(helmet_rings) - 1) * segments + i
    for i in range(segments)
))

mesh(
    "Carcasa blanca del casco",
    vertices, faces,
    white, 1
)

face = sphere(
    "Panel del rostro",
    (0, -.735, 4.76),
    (.848, .225, .779),
    skin
)

for vertex in face.data.vertices:
    vertex.co = tuple(
        signed_power(value, .72)
        for value in vertex.co
    )

# Ojos con extremos semicirculares.
for sign in [-1, 1]:
    outline = []

    for i in range(33):
        angle = math.pi * i / 32

        outline.append((
            sign * .405 + .088 * math.cos(angle),
            4.72 + .245 + .088 * math.sin(angle)
        ))

    for i in range(33):
        angle = math.pi + math.pi * i / 32

        outline.append((
            sign * .405 + .088 * math.cos(angle),
            4.72 - .245 + .088 * math.sin(angle)
        ))

    count = len(outline)

    vertices = [
        (x, y, z)
        for y in [-1.005, -.935]
        for x, z in outline
    ]

    faces = [
        tuple(reversed(range(count))),
        tuple(count + i for i in range(count))
    ]

    for i in range(count):
        faces.append((
            i,
            (i + 1) % count,
            (i + 1) % count + count,
            i + count
        ))

    eye = mesh(
        "Ojo negro",
        vertices, faces,
        black
    )

    modifier = eye.modifiers.new("Borde pulido", "BEVEL")
    modifier.width = .009
    modifier.segments = 3
    eye.modifiers.new("Normales", "WEIGHTED_NORMAL")

# Cejas triangulares.
for sign in [-1, 1]:
    points = [
        (sign * .78, 5.27),
        (sign * .71, 5.12),
        (sign * .16, 4.995),
        (sign * .52, 5.22)
    ]

    vertices = [
        (x, y, z)
        for y in [-1.016, -.945]
        for x, z in points
    ]

    faces = [
        (0, 1, 2, 3),
        (7, 6, 5, 4),
        (0, 4, 5, 1),
        (1, 5, 6, 2),
        (2, 6, 7, 3),
        (3, 7, 4, 0)
    ]

    brow = mesh(
        "Ceja",
        vertices, faces,
        brows
    )

    modifier = brow.modifiers.new("Borde mínimo", "BEVEL")
    modifier.width = .007
    modifier.segments = 2
    brow.modifiers.new("Normales", "WEIGHTED_NORMAL")

head_parent = pivot("Antena", (0, .025, 5.86), PIV["Cabeza"])

sphere(
    "Base blanca de antena",
    (0, .025, 6.04),
    (.16, .15, .24),
    white
)

sphere(
    "Esfera rosa de antena",
    (0, .025, 6.43),
    (.405, .405, .405),
    pink
)

PIV["Cabeza"].location.z -= .12
head_parent = None

# =========================================================
# =========================================================
# EXPORTACIÓN (solo el personaje) + render de control
# =========================================================
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
for obj in model.objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = next(obj for obj in model.objects if obj.type == "MESH")
bpy.ops.export_scene.gltf(
    filepath=str(CARPETA / f"{NOMBRE}.glb"), export_format="GLB", use_selection=True,
    export_apply=True, export_cameras=False, export_lights=False,
)
if os.environ.get("HEROE_RENDER"):
    active_collection = studio
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, .005))
    finish(bpy.context.object, "Suelo", backdrop)
    for loc, en in [((-4, -6, 10), 1050), ((5, -4, 6), 900), ((-3, 4, 7), 900)]:
        bpy.ops.object.light_add(type="AREA", location=loc)
        l = bpy.context.object; l.data.energy = en; l.data.size = 4
        l.rotation_euler = (Vector((0, 0, 3.4)) - l.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.camera_add(location=(7, -23, 8))
    cam = bpy.context.object
    cam.rotation_euler = (Vector((0, 0, 3.4)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.type = "ORTHO"; cam.data.ortho_scale = 7.5; scene.camera = cam
    scene.render.filepath = str(CARPETA / f"{NOMBRE}.png")
    bpy.ops.render.render(write_still=True)
print("OK", CARPETA)
