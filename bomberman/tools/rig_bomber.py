# Rig + game animations for the Bomber character (Blender 5.x).
#
# Works on the owner's files without changing the design: every part is parented rigidly to a bone of a new
# armature, so the rest pose is exactly the original pose (bomb in hand). Animations are actions on the armature:
#   idle, caminar, correr, poner_bomba, victoria, dano, morir      (24 fps; caminar/correr/idle/victoria loop)
#
# Modes (environment variables):
#   MODE=blend  IN=bomber.blend  OUT=bomber-animado.blend   → editable copy of the scene "Bomber • estudio"
#               (+ PREVIEW=dir renders a few frames per action)
#   MODE=glb    IN=bomber.glb    OUT=bomber-animado.glb     → game export: lighter mesh + animations
#
# Run:  blender -b -P rig_bomber.py   (or python with the bpy module)
import bpy, math, os
from mathutils import Vector, Quaternion, Matrix

MODE = os.environ.get("MODE", "blend")
IN, OUT = os.environ["IN"], os.environ["OUT"]
SCENE = "Bomber • estudio"
FPS = 24

# ---------------------------------------------------------------- scene
if MODE == "blend":
    bpy.ops.wm.open_mainfile(filepath=IN)
    sc = bpy.data.scenes[SCENE]
    bpy.context.window.scene = sc
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=IN)
    # The game camera looks down at ~45°: brows standing proud of the face show their black top face and read as
    # bars. For the game export only, project them onto the face plate (front view, a hair above the skin): the
    # silhouette stays exactly as designed, only the slab depth goes.
    from mathutils.bvhtree import BVHTree
    face = next((o for o in bpy.context.scene.objects if o.name.lower().startswith("placa rostro")), None)
    if face:
        fm = face.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        tree = BVHTree.FromPolygons([face.matrix_world @ v.co for v in fm.vertices], [p.vertices[:] for p in fm.polygons])
        for o in bpy.context.scene.objects:
            if not o.name.lower().startswith("ceja"): continue
            inv = o.matrix_world.inverted()
            for v in o.data.vertices:
                w = o.matrix_world @ v.co
                hit = tree.ray_cast(Vector((w.x, -5.0, w.z)), Vector((0, 1, 0)))[0]   # first hit from the front = outer skin
                if hit is not None: v.co = inv @ Vector((w.x, hit.y - 0.012, w.z))
            o.data.update()
sc.render.fps = FPS

EXCLUDE = ("suelo", "softbox", "relleno", "contraluz", "cámara")
parts = [o for o in sc.objects if o.type in ("MESH", "CURVE") and not any(k in o.name.lower() for k in EXCLUDE)]

# ---------------------------------------------------------------- bones (Blender space: -Y is the front)
BONES = {   # name: (head, tail, parent)
    "raiz":      ((0, 0, 0), (0, 0, 0.6), None),
    "cadera":    ((0, 0, 1.55), (0, 0, 1.95), "raiz"),
    "torso":     ((0, 0, 1.95), (0, 0, 2.85), "cadera"),
    "cabeza":    ((0, 0, 2.85), (-0.07, 0, 3.8), "torso"),
    "antena":    ((-0.15, 0, 4.45), (-0.22, 0, 5.13), "cabeza"),
    "pierna.L":  ((-0.24, 0, 1.68), (-0.22, -0.04, 0.57), "cadera"),
    "pierna.R":  ((0.23, 0, 1.67), (0.35, -0.03, 0.59), "cadera"),
    "brazo.L":   ((-0.55, -0.03, 2.45), (-0.95, -0.24, 2.15), "torso"),
    "brazo.R":   ((0.55, -0.02, 2.48), (0.75, -0.15, 1.9), "torso"),
    "bomba":     ((-1.21, -0.2, 2.68), (-1.21, -0.2, 3.28), "brazo.L"),
}

def side(o, name):
    if "izquierd" in name: return "L"
    if "derech" in name: return "R"
    if o.type == "MESH" and len(o.data.vertices):
        c = sum((o.matrix_world @ v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)
    else:
        c = o.matrix_world.translation
    return "L" if c.x < 0 else "R"

def bone_for(o):
    n = o.name.lower()
    if n.startswith("bomba") or any(k in n for k in ("boca de la mecha", "anillo boca", "hebra de mecha", "núcleo incandescente", "chispa")):
        return "bomba"
    if any(k in n for k in ("antena", "bola rosa")): return "antena"
    if any(k in n for k in ("casco", "rostro", "reflejo ojo", "ceja", "ojo negro")): return "cabeza"
    if any(k in n for k in ("pierna", "suela", "botita", "aro superior", "interior del aro", "panel frontal bota", "cierre blanco bota", "hebilla bota", "nervio empeine")):
        return "pierna." + side(o, n)
    if any(k in n for k in ("manga", "brazo", "guante", "puño", "pulgar", "manopla")): return "brazo." + side(o, n)
    if any(k in n for k in ("cadera", "cinturón", "hebilla dorada", "centro hebilla")): return "cadera"
    if any(k in n for k in ("torso", "espalda chaqueta", "panel abierto", "costura frontal", "patrón chaqueta")): return "torso"
    print("  (sin regla, va al torso):", o.name)
    return "torso"

arm_data = bpy.data.armatures.new("Rig Bomber")
arm = bpy.data.objects.new("Rig Bomber", arm_data)
sc.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for name, (h, t, p) in BONES.items():
    eb = arm_data.edit_bones.new(name); eb.head = h; eb.tail = t; eb.roll = 0
for name, (h, t, p) in BONES.items():
    if p: arm_data.edit_bones[name].parent = arm_data.edit_bones[p]
bpy.ops.object.mode_set(mode="OBJECT")
arm_data.display_type = "STICK"

# rigid parenting that keeps every part exactly where it is
bpy.context.view_layer.update()
for o in parts:
    b = bone_for(o)
    mw = o.matrix_world.copy()
    o.parent = arm; o.parent_type = "BONE"; o.parent_bone = b
    pb = arm.pose.bones[b]
    o.matrix_parent_inverse = (arm.matrix_world @ pb.matrix @ Matrix.Translation((0, pb.bone.length, 0))).inverted()
    o.matrix_world = mw
bpy.context.view_layer.update()

# ---------------------------------------------------------------- posing helpers
REST = {b.name: b.matrix_local.to_quaternion() for b in arm_data.bones}
def to_local(bone, qworld):          # an armature-space rotation, applied in the bone's rest frame
    R = REST[bone]; return R.inverted() @ qworld @ R
def vloc(bone, v):                   # an armature-space offset → the bone's local location
    return REST[bone].inverted() @ Vector(v)
X, Y, Zax = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
rot = lambda axis, a: Quaternion(axis, a)
def bdir(b): h, t, _ = BONES[b]; return Vector(t) - Vector(h)
# the left arm holds the bomb out; for walking it hangs like the right arm (mirrored)
dR = bdir("brazo.R"); _hang = Vector((-dR.x, dR.y, dR.z))
# …and turned about its own axis so the open bomb-holding palm faces the body instead of the sky
NEUTRAL_L = Quaternion(_hang.normalized(), float(os.environ.get("PALM_TWIST", "-1.3"))) @ bdir("brazo.L").rotation_difference(_hang)
UP_L = bdir("brazo.L").rotation_difference(Vector((-0.55, -0.1, 1)))
UP_R = bdir("brazo.R").rotation_difference(Vector((0.55, -0.1, 1)))
I = Quaternion()
for pb in arm.pose.bones: pb.rotation_mode = "QUATERNION"

def make_action(name, frames, pose, loop=True):
    """pose(t) → {bone: (world_rot | None, world_offset | None, scale | None)}, t in [0, 1]."""
    ad = arm.animation_data or arm.animation_data_create()
    act = bpy.data.actions.new(name); act.use_fake_user = True
    ad.action = act
    last = {}
    for f in range(frames + 1):
        t = f / frames
        P = pose(t)
        for pb in arm.pose.bones:
            r, off, s = P.get(pb.name, (None, None, None))
            q = to_local(pb.name, r) if r is not None else Quaternion()
            if pb.name in last and last[pb.name].dot(q) < 0: q.negate()   # stay on one hemisphere
            last[pb.name] = q.copy()
            pb.rotation_quaternion = q
            pb.location = vloc(pb.name, off) if off is not None else Vector()
            pb.scale = Vector(s) if s is not None else Vector((1, 1, 1))
            pb.keyframe_insert("rotation_quaternion", frame=f + 1)
            pb.keyframe_insert("location", frame=f + 1)
            pb.keyframe_insert("scale", frame=f + 1)
    act.frame_range = (1, frames + 1)
    tr = ad.nla_tracks.new(); tr.name = name
    tr.strips.new(name, 1, act)
    ad.action = None
    return act

HIDE = (0.001, 0.001, 0.001)
def walk_pose(t, legs, arms, bob, lean, twist, hop=False):
    p = 2 * math.pi * t; s = math.sin(p)
    b = (abs(math.sin(p)) * bob) if hop else bob * math.cos(2 * p)
    return {
        "cadera":   (rot(Zax, -twist * 0.6 * s), (0, 0, b), None),
        "torso":    (rot(X, lean) @ rot(Zax, twist * s), None, None),
        "cabeza":   (rot(Zax, -twist * 0.8 * s) @ rot(X, -lean * 0.5), None, None),
        "antena":   (rot(X, 0.22 * math.sin(2 * p - 1.2)) @ rot(Y, 0.1 * math.sin(p - 1.0)), None, None),
        "pierna.L": (rot(X, -legs * s), None, None),
        "pierna.R": (rot(X, legs * s), None, None),
        "brazo.L":  (rot(X, arms * s) @ NEUTRAL_L, None, None),
        "brazo.R":  (rot(X, -arms * s), None, None),
        "bomba":    (None, None, HIDE),
    }

ACTIONS = {}
ACTIONS["idle"] = make_action("idle", 48, lambda t: {
    "cadera":  (None, (0, 0, 0.012 * math.sin(2 * math.pi * t)), None),
    "torso":   (rot(X, 0.015 * math.sin(2 * math.pi * t)), None, (1, 1 + 0.018 * math.sin(2 * math.pi * t), 1)),
    "cabeza":  (rot(Zax, 0.1 * math.sin(2 * math.pi * t)) @ rot(X, 0.03 * math.sin(4 * math.pi * t)), None, None),
    "antena":  (rot(Y, 0.08 * math.sin(2 * math.pi * t - 0.9)) @ rot(X, 0.05 * math.sin(4 * math.pi * t - 0.5)), None, None),
    "brazo.L": (rot(X, 0.04 * math.sin(2 * math.pi * t)) @ NEUTRAL_L, None, None),
    "brazo.R": (rot(X, -0.04 * math.sin(2 * math.pi * t)), None, None),
    "bomba":   (None, None, HIDE),
})
ACTIONS["caminar"] = make_action("caminar", 24, lambda t: walk_pose(t, 0.5, 0.42, 0.045, 0.06, 0.09))
ACTIONS["correr"] = make_action("correr", 16, lambda t: walk_pose(t, 0.85, 0.8, 0.09, 0.18, 0.14, hop=True))

PLACE_L = bdir("brazo.L").rotation_difference(Vector((-0.2, -0.55, -0.8)))   # reaching down in front
ease = lambda x: 0.5 - 0.5 * math.cos(math.pi * max(0.0, min(1.0, x)))
def place(t):   # pull a bomb, crouch forward, set it down in front, straighten up
    k = math.sin(math.pi * min(1, t / 0.75)) if t < 0.75 else 0
    if t < 0.45: armL = I.slerp(PLACE_L, ease(t / 0.45))
    elif t < 0.55: armL = PLACE_L
    else: armL = PLACE_L.slerp(NEUTRAL_L, ease((t - 0.55) / 0.45))
    bomb = min(1, t / 0.12) if t < 0.5 else 0.001
    return {
        "cadera":   (None, (0, -0.05 * k, -0.16 * k), None),
        "torso":    (rot(X, 0.42 * k), None, None),
        "cabeza":   (rot(X, 0.18 * k), None, None),
        "antena":   (rot(X, -0.3 * k + 0.15 * math.sin(t * 9)), None, None),
        "pierna.L": (rot(X, -0.12 * k), None, None),
        "pierna.R": (rot(X, 0.18 * k), None, None),
        "brazo.L":  (armL, None, None),
        "brazo.R":  (rot(X, 0.25 * k), None, None),
        "bomba":    (None, None, (bomb, bomb, bomb)),
    }
ACTIONS["poner_bomba"] = make_action("poner_bomba", 24, place, loop=False)

ACTIONS["victoria"] = make_action("victoria", 32, lambda t: {
    "raiz":     (None, (0, 0, 0.42 * max(0, math.sin(2 * math.pi * t))), None),
    "cadera":   (rot(Zax, 0.12 * math.sin(2 * math.pi * t)), None, None),
    "torso":    (rot(X, -0.08 * max(0, math.sin(2 * math.pi * t))), None, None),
    "cabeza":   (rot(X, -0.12 * max(0, math.sin(2 * math.pi * t))), None, None),
    "antena":   (rot(X, 0.35 * math.sin(4 * math.pi * t - 1.2)), None, None),
    "brazo.L":  (rot(Y, -0.3 * math.sin(4 * math.pi * t)) @ UP_L, None, None),
    "brazo.R":  (rot(Y, 0.3 * math.sin(4 * math.pi * t + 0.6)) @ UP_R, None, None),
    "pierna.L": (rot(X, -0.25 * max(0, math.sin(2 * math.pi * t))), None, None),
    "pierna.R": (rot(X, 0.1 * max(0, math.sin(2 * math.pi * t))), None, None),
    "bomba":    (None, None, HIDE),
})

def hurt(t):
    k = math.sin(math.pi * t) * (1 - 0.3 * t)
    return {
        "cadera":  (None, (0, 0.1 * k, -0.05 * k), None),
        "torso":   (rot(X, -0.35 * k), None, None),
        "cabeza":  (rot(X, -0.25 * k) @ rot(Zax, 0.15 * math.sin(t * 20) * k), None, None),
        "antena":  (rot(X, 0.5 * math.sin(t * 14) * k), None, None),
        "brazo.L": (rot(X, 0.6 * k) @ NEUTRAL_L, None, None),
        "brazo.R": (rot(X, 0.6 * k), None, None),
        "bomba":   (None, None, HIDE),
    }
ACTIONS["dano"] = make_action("dano", 12, hurt, loop=False)

def die(t):
    spin = 4 * math.pi * t ** 1.4
    s = max(0.001, 1 - max(0, t - 0.45) / 0.55)
    return {
        "raiz":    (rot(Zax, spin), (0, 0, 0.9 * math.sin(math.pi * min(1, t * 1.2))), (s, s, s)),
        "torso":   (rot(X, -0.2 * math.sin(math.pi * t)), None, None),
        "cabeza":  (rot(X, -0.3 * math.sin(math.pi * t)), None, None),
        "antena":  (rot(X, 0.6 * math.sin(t * 18)), None, None),
        "brazo.L": (UP_L.slerp(NEUTRAL_L, 0.3), None, None),
        "brazo.R": (UP_R.slerp(I, 0.3), None, None),
        "pierna.L": (rot(X, -0.3), None, None),
        "pierna.R": (rot(X, 0.3), None, None),
        "bomba":   (None, None, HIDE),
    }
ACTIONS["morir"] = make_action("morir", 40, die, loop=False)

# rest pose for the studio scene (the original pose, bomb in hand)
for pb in arm.pose.bones:
    pb.rotation_quaternion = Quaternion(); pb.location = Vector(); pb.scale = Vector((1, 1, 1))

# ---------------------------------------------------------------- output
if MODE == "blend":
    for tr in arm.animation_data.nla_tracks: tr.mute = True   # studio renders the rest pose; pick an action to preview
    prev = os.environ.get("PREVIEW")
    if prev:
        os.makedirs(prev, exist_ok=True)
        sc.cycles.samples = int(os.environ.get("SAMPLES", "12"))
        sc.render.resolution_percentage = int(os.environ.get("RES", "30"))
        sc.render.film_transparent = False
        shots = os.environ.get("SHOTS", "idle:1,caminar:1,caminar:7,caminar:13,caminar:19,correr:5,poner_bomba:10,victoria:9,dano:6,morir:20").split(",")
        for shot in shots:
            an, f = shot.split(":")
            arm.animation_data.action = ACTIONS[an]
            sc.frame_set(int(f))
            sc.render.filepath = os.path.join(prev, f"{an}_{int(f):02d}.png")
            bpy.ops.render.render(write_still=True, scene=sc.name)
        arm.animation_data.action = None
        sc.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
else:
    # lighter mesh for phones: decimate the dense parts (fuse strands, helmet, spheres); shapes stay the same
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    for o in parts:
        if o.type != "MESH": continue
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        n = o.name.lower()
        floor = 0.3 if any(k in n for k in ("casco", "rostro", "chaqueta", "patrón")) else 0.01
        target = 40 if "chispa" in n else 700 if "hebra" in n else 650   # sparks are tiny streaks; the fuse a thin braid
        r = min(1.0, max(floor, target / max(1, tris)))
        if r < 0.98:
            m = o.modifiers.new("Decimar juego", "DECIMATE"); m.ratio = r
        total += int(tris * r)
    print("triangulos aprox. tras decimar:", total)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True,
                              export_animations=True, export_animation_mode="ACTIONS", export_cameras=False, export_lights=False)
print("OK", OUT)
