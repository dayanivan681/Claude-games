# Slugger hero (Rayo) sprite pipeline, realistic version.
#
# Builds Rayo in Blender from real assets and renders every game pose with Cycles in full colour:
#   - body + skeleton: Mixamo "X Bot" (realistic proportions, mixamorig rig with IK added here); the
#     legs of the run cycle are its motion-captured "run" clip, every other pose is IK-driven from the
#     game's 2D skeleton (js/soldier.js);
#   - head: the Lee Perry-Smith head scan (Infinite-Realities, CC BY 3.0), cut at the neck and fitted
#     onto the Head bone;
#   - suit, gear, hair, bandana and guns: modelled here, PBR materials, costume colours from
#     js/sprites.js (HERO_LOOKS[0]).
# Legs and upper body are separate layers (Metal Slug style: the upper body rides the hip), plus an
# 8-frame full-body roll. Output: one atlas per costume (img/rayo_<n>.webp) and the frame table in
# js/hero_art.js. The downloaded models live in /tmp/slugger_hero and are never committed (Mixamo's
# terms forbid redistributing the raw files).
#
# Run from the repo root:  python3 slugger/art/hero.py [--preview out.png] [--quick]
# Needs the bpy module (pip install bpy). Axes: +X forward (the hero faces right), +Z up, -Y toward
# the camera (near side = the hero's right). Units: metres; M world px per metre, R sprite px per world px.
import bpy, bmesh, math, os, sys, json, re, hashlib, urllib.request
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = "/tmp/slugger_hero"
os.makedirs(TMP, exist_ok=True)
QUICK = "--quick" in sys.argv
M = 15.0                      # world px per metre (the hero stands ~27 world px tall)
R = 6                         # sprite px per world px
PPM = M * R                   # sprite px per metre
RES = 336                     # render canvas (px); the world origin (feet) sits at pixel (RES/2, ORG_Y)
ORG_Y = 290
SAMPLES = 8 if QUICK else 48

T3 = "https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/"
FILES = {   # name -> (url, sha256)
    "Xbot.glb": (T3 + "Xbot.glb", "002f8d269de68e5dce3d25195caf390d1aa359bbfaae3fcf4c8dc78ec36c3ba5"),
    "LeePerrySmith.glb": (T3 + "LeePerrySmith/LeePerrySmith.glb",
        "402b8a8ac9f03232e6d64b5962929703a069daf99d3c49ac8eb0e48bedc9c576"),
    "Map-COL.jpg": (T3 + "LeePerrySmith/Map-COL.jpg",
        "e976d73b31407f8d0967412bf468019ed26a5d5a32cf5811aabff7e816458a65"),
    "Infinite-Level_02_Tangent_SmoothUV.jpg": (T3 + "LeePerrySmith/Infinite-Level_02_Tangent_SmoothUV.jpg",
        "36925e51ad9b324b94e8faf4692da1b4132809f2762bb8d5bd549ffd215d4ca6"),
}

def fetch(name):
    path = f"{TMP}/{name}"
    url, sha = FILES[name]
    ok = lambda: os.path.exists(path) and hashlib.sha256(open(path, "rb").read()).hexdigest() == sha
    if not ok():
        print("fetching", url, flush=True); urllib.request.urlretrieve(url, path)
        if not ok(): sys.exit(f"{name}: checksum mismatch")
    return path

# ---------- costume colours, read from js/sprites.js so the game and the renders agree ----------
def costumes():
    src = open(os.path.join(ROOT, "js", "sprites.js")).read()
    obj = lambda s: dict(re.findall(r'(\w+): "(#[0-9a-fA-F]{6})"', s))
    base = obj(re.search(r"const basePal = \{(.*?)\};", src, re.S).group(1))
    block = re.search(r'head: "h_rayo".*?pals: \[(.*?)\] \}', src, re.S).group(1)
    pals = [obj(p) for p in re.findall(r"\{([^{}]*)\}", block)]
    return [{**base, **p} for p in pals]

def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]

# ---------- materials ----------
MATS = {}
def mat(name, color=(0.5, 0.5, 0.5, 1), rough=0.6, metal=0.0, bump=None, emit=None, sheen=0.0, coat=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = color; b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if sheen: b.inputs["Sheen Weight"].default_value = sheen
    if coat: b.inputs["Coat Weight"].default_value = coat
    if emit: b.inputs["Emission Color"].default_value = emit; b.inputs["Emission Strength"].default_value = 3.0
    if bump:   # (kind, scale, strength): fabric ribs or a noisy surface, in object space
        kind, scale, strength = bump
        tc = nt.nodes.new("ShaderNodeTexCoord"); bp = nt.nodes.new("ShaderNodeBump"); bp.inputs["Strength"].default_value = strength
        if kind == "rib":
            t = nt.nodes.new("ShaderNodeTexWave"); t.wave_type = "BANDS"; t.bands_direction = "Z"; t.inputs["Scale"].default_value = scale
            t.inputs["Distortion"].default_value = 1.5
        else:
            t = nt.nodes.new("ShaderNodeTexNoise"); t.inputs["Scale"].default_value = scale; t.inputs["Detail"].default_value = 6
        nt.links.new(tc.outputs["Object"], t.inputs["Vector"]); nt.links.new(t.outputs["Fac"], bp.inputs["Height"])
        nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
    MATS[name] = m
    return m

def make_materials():
    mat("suit", rough=0.62, sheen=0.4, bump=("rib", 2.2, 0.35))       # ribbed sneaking suit (upper body)
    mat("pants", rough=0.66, sheen=0.3, bump=("noise", 90, 0.25))
    mat("boot", rough=0.38, bump=("noise", 60, 0.2), coat=0.3)
    mat("glove", (0.035, 0.032, 0.03, 1), rough=0.45, bump=("noise", 120, 0.15))
    mat("webbing", rough=0.85, bump=("rib", 60, 0.25))                 # belt, harness, holster
    mat("pouch", rough=0.8, bump=("noise", 70, 0.3))
    mat("bandana", rough=0.75, sheen=0.5, bump=("noise", 80, 0.2))
    mat("hair", (0.03, 0.018, 0.01, 1), rough=0.42, bump=("noise", 160, 0.8), sheen=0.6)
    mat("gun_dark", (0.03, 0.03, 0.035, 1), rough=0.35, metal=0.8, bump=("noise", 200, 0.05))
    mat("gun_mid", (0.09, 0.09, 0.1, 1), rough=0.3, metal=0.9)
    mat("gun_light", (0.4, 0.4, 0.44, 1), rough=0.22, metal=1.0)
    mat("steel", (0.75, 0.75, 0.78, 1), rough=0.15, metal=1.0)
    mat("brass", srgb("#e8c050"), rough=0.25, metal=1.0)
    mat("wood", srgb("#6a4520"), rough=0.5, bump=("rib", 40, 0.15), coat=0.4)
    mat("olive", srgb("#5d6b32"), rough=0.55, bump=("noise", 50, 0.1))
    mat("olive_d", srgb("#3e4822"), rough=0.6)
    mat("orange", srgb("#ff8a1a"), rough=0.4, coat=0.5)
    mat("red", srgb("#c83a2a"), rough=0.4)
    mat("pump", srgb("#a87438"), rough=0.5)
    mat("laser", srgb("#8fd0e8"), rough=0.2, emit=srgb("#8fd0e8"))
    mat("laser_tip", srgb("#e6f6ff"), rough=0.1, emit=srgb("#e6f6ff"))
    mat("radio", (0.05, 0.05, 0.05, 1), rough=0.5)
    # skin: the head scan's colour and normal maps
    m = bpy.data.materials.new("skin"); m.use_nodes = True; nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(fetch("Map-COL.jpg"))
    nm = nt.nodes.new("ShaderNodeTexImage"); nm.image = bpy.data.images.load(fetch("Infinite-Level_02_Tangent_SmoothUV.jpg")); nm.image.colorspace_settings.name = "Non-Color"
    nmap = nt.nodes.new("ShaderNodeNormalMap"); nmap.inputs["Strength"].default_value = 0.8
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"]); nt.links.new(nm.outputs["Color"], nmap.inputs["Color"]); nt.links.new(nmap.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = 0.5; b.inputs["Subsurface Weight"].default_value = 0.08
    MATS["skin"] = m

def set_costume(p):
    lift = lambda h, k=1.0: [min(1.0, c * k) for c in srgb(h)[:3]] + [1.0]
    col = {"suit": lift(p["C"]), "pants": lift(p["P"]), "boot": lift(p["B"]), "webbing": lift(p["K"]), "pouch": lift(p["N"]), "bandana": lift(p["A"])}
    for k, c in col.items(): MATS[k].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = c

# ---------- the body: X Bot, split into the legs layer and the upper-body layer ----------
BELT_Z = 1.03                 # rest-pose height of the belt (metres)
LOWER = {"Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"}
DROP = {"Head", "Neck", "HeadTop_End", "LeftEye", "RightEye"}

def seg_of(name):
    n = name.split(":")[-1]
    for side in ("Left", "Right"):
        if n.startswith(side + "Hand"): return side + "Hand"
        if n.startswith(side + "Toe"): return side + "ToeBase"
    return n

def build_body():
    bpy.ops.import_scene.gltf(filepath=fetch("Xbot.glb"))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name not in ("Beta_Surface", "Beta_Joints"): bpy.data.objects.remove(o)
    # the mannequin's joints (waist, shoulders, knees...) are a separate mesh: one skin
    bpy.ops.object.select_all(action="DESELECT")
    for n in ("Beta_Joints", "Beta_Surface"): bpy.data.objects[n].select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects["Beta_Surface"]; bpy.ops.object.join()
    root = bpy.data.objects.new("root", None); bpy.context.scene.collection.objects.link(root)
    arm.parent = root; root.rotation_euler.z = math.pi / 2          # rest faces -Y; turn it to face +X
    sample_run(arm)
    if arm.animation_data: arm.animation_data.action = None
    fix_bones(arm)
    for b in arm.pose.bones:     # the import leaves the file's default pose on; start from the rest pose
        b.location = (0, 0, 0); b.rotation_quaternion = (1, 0, 0, 0); b.rotation_euler = (0, 0, 0); b.scale = (1, 1, 1)
    body = bpy.data.objects["Beta_Surface"]
    gname = {g.index: seg_of(g.name) for g in body.vertex_groups}
    me = body.data; nv = len(me.vertices)
    dom = []
    for v in me.vertices:
        acc = {}
        for g in v.groups: acc[gname[g.group]] = acc.get(gname[g.group], 0) + g.weight
        dom.append(max(acc, key=acc.get) if acc else "Hips")
    rest = [(body.matrix_world @ v.co) for v in me.vertices]
    parts = {}
    for layer in ("lower", "upper"):
        ob = body.copy(); ob.data = me.copy(); ob.name = "body_" + layer; bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.clear()
        for k in ("suit", "pants", "glove", "boot"): ob.data.materials.append(MATS[k])
        bm = bmesh.new(); bm.from_mesh(ob.data); bm.verts.ensure_lookup_table()
        kill = []
        for f in bm.faces:
            segs = [dom[v.index] for v in f.verts]; s = max(set(segs), key=segs.count)
            z = min(rest[v.index].z for v in f.verts); zc = sum(rest[v.index].z for v in f.verts) / len(f.verts)
            leg = s in LOWER and s != "Hips"
            # the layers meet at the belt with an overlap: legs keep the pelvis up to the belt, the upper body starts below it
            keep = (s in LOWER and zc < BELT_Z + 0.03) if layer == "lower" else (not leg and (s != "Hips" or zc > BELT_Z - 0.05))
            if s in DROP or not keep: kill.append(f); continue
            if "Hand" in s: f.material_index = 2
            elif "Foot" in s or "Toe" in s or ("Leg" in s and "Up" not in s and z < 0.2): f.material_index = 3
            else: f.material_index = 1 if layer == "lower" else 0
            f.smooth = True
        bmesh.ops.delete(bm, geom=kill, context="FACES"); bm.to_mesh(ob.data); bm.free()
        parts[layer] = ob
    bpy.data.objects.remove(body)
    return arm, root, parts

RUN = []
def sample_run(arm):
    """World positions of the leg joints over the mocap run clip (12 frames over its 16.8-frame loop)."""
    arm.animation_data.action = bpy.data.actions["run"]
    for i in range(12):
        f = i * 16.8 / 12; bpy.context.scene.frame_set(int(f), subframe=f - int(f)); bpy.context.view_layer.update()
        RUN.append({n: (arm.matrix_world @ arm.pose.bones["mixamorig:" + n].head).copy() for n in
                    ("Hips", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase")})
    bpy.context.scene.frame_set(0)

NEXT = {"Hips": "Spine", "Spine": "Spine1", "Spine1": "Spine2", "Spine2": "Neck", "Neck": "Head", "Head": "HeadTop_End",
        "Shoulder": "Arm", "Arm": "ForeArm", "ForeArm": "Hand", "Hand": "HandMiddle1", "UpLeg": "Leg", "Leg": "Foot", "Foot": "ToeBase", "ToeBase": "Toe_End"}
def fix_bones(arm):
    """The glTF import leaves every tail ~44 m up; point each bone at its child so IK has real segments."""
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for b in eb:
        n = b.name.split(":")[-1]; side = "Left" if n.startswith("Left") else "Right" if n.startswith("Right") else ""
        key = n[len(side):]; nxt = None
        if key in NEXT: nxt = "mixamorig:" + side + NEXT[key] if key not in ("Hips", "Spine", "Spine1", "Spine2", "Neck", "Head") else "mixamorig:" + NEXT[key]
        m = re.match(r"(\w+?Hand\w+?)(\d)$", n)
        if m: nxt = f"mixamorig:{m.group(1)}{int(m.group(2)) + 1}"
        if nxt and nxt in eb and (eb[nxt].head - b.head).length > 1e-3: b.tail = eb[nxt].head
        elif b.parent: b.tail = b.head + (b.head - b.parent.head).normalized() * max(2.0, (b.head - b.parent.head).length * 0.5)
    bpy.ops.object.mode_set(mode="OBJECT")

def bone_world(arm, name, tail=False):
    bpy.context.view_layer.update()
    b = arm.pose.bones["mixamorig:" + name]
    return arm.matrix_world @ (b.tail if tail else b.head)

def attach(ob, arm, bone):
    """Parent an object to a bone, keeping its current world transform."""
    bpy.context.view_layer.update()
    mw = ob.matrix_world.copy()
    ob.parent = arm; ob.parent_type = "BONE"; ob.parent_bone = "mixamorig:" + bone
    bpy.context.view_layer.update()
    ob.matrix_world = mw

def link(ob): bpy.context.scene.collection.objects.link(ob); return ob

def prim(kind, name, matname, loc, scale=(1, 1, 1), rot=(0, 0, 0), bevel=0.0, **kw):
    if kind == "box": bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    elif kind == "cyl": bpy.ops.mesh.primitive_cylinder_add(vertices=kw.get("seg", 20), radius=0.5, depth=1, location=loc, rotation=rot)
    elif kind == "sphere": bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=14, radius=0.5, location=loc, rotation=rot)
    ob = bpy.context.active_object; ob.name = name; ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        md = ob.modifiers.new("bev", "BEVEL"); md.width = bevel; md.segments = 2; md.limit_method = "ANGLE"
    for p in ob.data.polygons: p.use_smooth = kind != "box"
    if kind == "box": ob.modifiers.new("wn", "WEIGHTED_NORMAL")
    ob.data.materials.append(MATS[matname])
    return ob

def tube(name, matname, pts, r0, r1=None):
    """A tapered tube through points (cylinder segments + ball joints), as one mesh."""
    r1 = r0 if r1 is None else r1; obs = []
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        a, b = Vector(a), Vector(b); d = b - a
        r = r0 + (r1 - r0) * (i + 0.5) / (len(pts) - 1)
        ob = prim("cyl", name, matname, (a + b) / 2, scale=(2 * r, 2 * r, d.length), seg=12)
        ob.rotation_mode = "QUATERNION"; ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
        obs.append(ob)
        if i: obs.append(prim("sphere", name, matname, a, scale=(2 * r, 2 * r, 2 * r)))
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]; bpy.ops.object.join()
    return obs[0]

# ---------- head: the scan, cut at the neck, plus hair and bandana ----------
def build_head(arm):
    bpy.ops.import_scene.gltf(filepath=fetch("LeePerrySmith.glb"))
    h = bpy.data.objects["LeePerrySmith"]
    bpy.context.view_layer.update()
    co = np.array([h.matrix_world @ v.co for v in h.data.vertices])
    top = co[:, 2].max()
    # narrowest horizontal slice below the face = the neck
    zs = np.linspace(top - 0.75 * (top - co[:, 2].min()), top - 0.45 * (top - co[:, 2].min()), 30)
    width = [np.ptp(co[np.abs(co[:, 2] - z) < 0.05, 0]) if (np.abs(co[:, 2] - z) < 0.05).sum() > 8 else 1e9 for z in zs]
    zneck = zs[int(np.argmin(width))]
    bm = bmesh.new(); bm.from_mesh(h.data)
    mw = h.matrix_world
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if (mw @ v.co).z < zneck - 0.25 * (top - zneck) * 0.4], context="VERTS")
    bm.to_mesh(h.data); bm.free()
    for p in h.data.polygons: p.use_smooth = True
    h.data.materials.clear(); h.data.materials.append(MATS["skin"])
    # fit: crown on X Bot's head top, neck on its neck; the scan faces -Y like the rest pose, so turn it with the body
    htop = bone_world(arm, "HeadTop_End"); hneck = bone_world(arm, "Neck"); hhead = bone_world(arm, "Head")
    s = (htop.z - hneck.z) / (top - zneck) * 0.93
    up = co[co[:, 2] > zneck + 0.5 * (top - zneck)]
    cx, cy = up[:, 0].mean(), up[:, 1].mean()
    h.matrix_world = (Matrix.Translation((hhead.x, hhead.y, htop.z)) @ Matrix.Rotation(math.pi / 2, 4, "Z") @
                      Matrix.Scale(s, 4) @ Matrix.Translation((-cx, -cy - 0.02 / s, -top)) @ mw)
    bpy.context.view_layer.update()
    # skull geometry in world space for hair and bandana
    hc = np.array([h.matrix_world @ v.co for v in h.data.vertices])
    sk_top = hc[:, 2].max(); sk = hc[hc[:, 2] > sk_top - 0.12]
    c = Vector((sk[:, 0].mean() - 0.012, sk[:, 1].mean(), sk_top - 0.105))
    rx, ry = np.ptp(sk[:, 0]) / 2, np.ptp(sk[:, 1]) / 2
    parts = [h]
    # hair: a lumpy cap over the crown and the back of the head, longer at the nape
    hair = prim("sphere", "hair", "hair", c, scale=(2 * rx * 1.07, 2 * ry * 1.09, 0.25))
    bm = bmesh.new(); bm.from_mesh(hair.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.02 and v.co.x > -0.03 or v.co.z < -0.09], context="VERTS")
    rng = np.random.default_rng(7)
    for v in bm.verts:
        n = v.co.normalized(); v.co += n * (0.004 + 0.01 * rng.random())
        if v.co.x < -0.04 and v.co.z < 0.02: v.co.z -= 0.03 * (-v.co.x / 0.12)          # hangs over the nape
        if v.co.x > 0.06 and v.co.z > 0.0: v.co.x += 0.008; v.co.z -= 0.012              # swept fringe
    bm.to_mesh(hair.data); bm.free()
    hair.modifiers.new("sub", "SUBSURF").levels = 1
    disp = hair.modifiers.new("disp", "DISPLACE"); tx = bpy.data.textures.new("tuft", "CLOUDS"); tx.noise_scale = 0.02; disp.texture = tx; disp.strength = 0.008
    parts.append(hair)
    # bandana: a band around the brow, a knot and two tails flying back
    band = prim("cyl", "band", "bandana", (c.x + 0.005, c.y, c.z + 0.03), scale=(2 * rx * 1.13, 2 * ry * 1.16, 0.045), rot=(0, -0.18, 0), seg=32)
    parts.append(band)
    knot = prim("sphere", "knot", "bandana", (c.x - rx * 1.1, c.y, c.z + 0.02), scale=(0.035, 0.04, 0.035)); parts.append(knot)
    for i, (dy, L) in enumerate(((-0.012, 0.20), (0.012, 0.16))):
        k0 = Vector((c.x - rx * 1.12, c.y + dy, c.z + 0.02))
        pts = [k0, k0 + Vector((-L * 0.4, dy, -L * 0.25)), k0 + Vector((-L * 0.75, dy * 2, -L * (0.7 + 0.25 * i)))]
        parts.append(tube(f"tail{i}", "bandana", pts, 0.011, 0.006))
    for p in parts: attach(p, arm, "Head")
    return parts

# ---------- gear on the suit ----------
PHYSIQUE = {"Hips": 0.9, "Spine1": 1.08, "Spine2": 1.18, "Neck": 1.35, "LeftShoulder": 1.15, "RightShoulder": 1.15,
            "LeftArm": 1.15, "RightArm": 1.15, "LeftForeArm": 1.1, "RightForeArm": 1.1, "LeftUpLeg": 1.05, "RightUpLeg": 1.05}
def physique(arm):
    """X Bot is a slim mannequin; widen chest, shoulders, arms and neck and narrow the hips (bone thickness only)."""
    for b in arm.data.bones: b.inherit_scale = "NONE"
    for n, k in PHYSIQUE.items(): arm.pose.bones["mixamorig:" + n].scale = (k, 1.0, k)

def surface(obs):
    """World-space vertices of the deformed body meshes (for placing gear on the surface)."""
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get(); out = []
    for o in obs:
        e = o.evaluated_get(dg); me = e.to_mesh()
        out.append(np.array([e.matrix_world @ v.co for v in me.vertices])); e.to_mesh_clear()
    return np.concatenate(out)

def build_gear(arm, body):
    V, VL = surface([body["upper"]]), surface([body["lower"]])
    def near(P, z, y=None, dz=0.02, dy=0.03, x=None, dx=0.04):
        for _ in range(8):     # widen the window until it catches some surface
            m = np.abs(P[:, 2] - z) < dz
            if y is not None: m &= np.abs(P[:, 1] - y) < dy
            if x is not None: m &= np.abs(P[:, 0] - x) < dx
            if m.sum() >= 3: return P[m]
            dz, dy, dx = dz * 1.5, dy * 1.5, dx * 1.5
        sys.exit(f"no body surface near z={z:.3f} y={y}")
    up, lo = [], []
    hips = bone_world(arm, "Hips"); sp1 = bone_world(arm, "Spine1"); sp2 = bone_world(arm, "Spine2"); neck = bone_world(arm, "Neck")
    # belt: a ring just around the waist section, buckle in front, pouches on the hips, one at the back
    zb = hips.z - 0.01; W = near(np.concatenate([V, VL]), zb)
    x0, x1, y0, y1 = W[:, 0].min(), W[:, 0].max(), W[:, 1].min(), W[:, 1].max()
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    up.append((prim("cyl", "belt", "webbing", (cx, cy, zb), scale=(x1 - x0 + 0.02, y1 - y0 + 0.02, 0.05), seg=40), "Hips"))
    up.append((prim("box", "buckle", "gun_mid", (x1 + 0.012, cy, zb), scale=(0.012, 0.055, 0.04), bevel=0.003), "Hips"))
    for sy in (-1, 1):
        up.append((prim("box", "bpouch", "pouch", (cx + 0.035, cy + sy * ((y1 - y0) / 2 + 0.02), zb - 0.01), scale=(0.07, 0.04, 0.075), bevel=0.01), "Hips"))
    up.append((prim("box", "backpouch", "pouch", (x0 - 0.03, cy, zb + 0.03), scale=(0.05, 0.15, 0.09), bevel=0.012), "Hips"))
    # harness: two straps up the chest, over the shoulders and down the back
    for sy in (-1, 1):
        y = sy * 0.075; pts = []
        for z in (sp1.z - 0.03, sp1.z + 0.06, sp2.z + 0.04):
            S = near(np.concatenate([V, VL]), z, y); pts.append((S[:, 0].max() + 0.008, y, z))
        S = V[(np.abs(V[:, 1] - y * 1.3) < 0.02) & (np.abs(V[:, 0] - neck.x) < 0.03)]
        zt = S[:, 2].max() if len(S) else neck.z - 0.02
        pts.append((neck.x - 0.02, y * 1.3, zt + 0.006))
        up.append((tube("strap", "webbing", pts, 0.0085), "Spine2"))
    for sy in (-1, 1):
        z = sp1.z + 0.05; S = near(V, z, sy * 0.07)
        up.append((prim("box", "cpouch", "pouch", (S[:, 0].max() + 0.02, sy * 0.07, z), scale=(0.04, 0.065, 0.085), bevel=0.01), "Spine1"))
    z = sp2.z + 0.03; S = near(V, z, -0.075); rx = S[:, 0].max() + 0.025
    up.append((prim("box", "radio", "radio", (rx, -0.075, z), scale=(0.03, 0.035, 0.07), bevel=0.006), "Spine2"))
    up.append((prim("cyl", "antenna", "radio", (rx - 0.005, -0.085, z + 0.08), scale=(0.006, 0.006, 0.1), seg=6), "Spine2"))
    up.append((prim("cyl", "collar", "suit", (neck.x - 0.005, neck.y, neck.z + 0.035), scale=(0.115, 0.125, 0.09), seg=28), "Neck"))
    # thigh holster with the pistol, on the near (right) leg, two straps round the thigh
    rul = bone_world(arm, "RightUpLeg"); rl = bone_world(arm, "RightLeg"); mid = (rul + rl) / 2
    for k, dz in enumerate((0.07, -0.05)):
        T = near(VL, mid.z + dz); T = T[T[:, 1] < 0]
        tx0, tx1, ty0, ty1 = T[:, 0].min(), T[:, 0].max(), T[:, 1].min(), T[:, 1].max()
        lo.append((prim("cyl", "thighstrap", "webbing", ((tx0 + tx1) / 2, (ty0 + ty1) / 2, mid.z + dz), scale=(tx1 - tx0 + 0.012, ty1 - ty0 + 0.012, 0.02), seg=24), "RightUpLeg"))
        if k == 0: hy = ty0; hx = (tx0 + tx1) / 2
    lo.append((prim("box", "holster", "webbing", (hx, hy - 0.02, mid.z + 0.03), scale=(0.1, 0.035, 0.19), bevel=0.012), "RightUpLeg"))
    lo.append((prim("box", "holstergun", "gun_dark", (hx - 0.01, hy - 0.035, mid.z + 0.12), scale=(0.06, 0.03, 0.055), bevel=0.008), "RightUpLeg"))
    # knee pads on the front of each knee
    for side, sy in (("Right", -1), ("Left", 1)):
        k = bone_world(arm, side + "Leg"); S = near(VL, k.z, k.y, dy=0.06)
        lo.append((prim("sphere", "kneepad", "pouch", (S[:, 0].max() - 0.015, k.y, k.z + 0.01), scale=(0.07, 0.115, 0.115)), side + "Leg"))
    for ob, bone in up + lo: attach(ob, arm, bone)
    return [o for o, _ in up], [o for o, _ in lo]

# ---------- guns (grip at the origin, +X along the barrel, +Z up), from the same part lists as before ----------
GS = 0.0216     # old hi-px -> metres (guns slightly smaller than the cartoon ones)
GUNS = {
    "pistol": dict(one=True, m=(10.0, 2.6), parts=[
        ("box", (-1.2, 0.2, 8.8, 3.6), 2.0, "gun_dark"), ("box", (0.0, 3.0, 9.0, 4.0), 1.6, "gun_mid"), ("box", (-1.4, -4.6, 2.0, 0.4), 1.8, "gun_dark"),
        ("box", (8.6, 1.4, 10.0, 3.4), 1.0, "gun_light")]),
    "H": dict(m=(23.0, 2.0), parts=[
        ("box", (-8.0, -1.2, -1.0, 3.2), 2.2, "gun_dark"), ("box", (-1.0, -1.4, 12.5, 4.4), 3.0, "gun_dark"), ("box", (0.0, 4.0, 11.0, 5.2), 2.2, "gun_mid"),
        ("cyl", (12.5, 2.0, 22.5, 2.0), 1.1, "gun_light"), ("cyl", (12.5, 2.0, 18.0, 2.0), 1.9, "gun_mid"), ("box", (3.0, -7.0, 7.0, -1.0), 2.0, "gun_mid"),
        ("box", (20.5, 0.6, 23.0, 3.4), 1.6, "gun_dark")]),
    "R": dict(m=(19.0, 2.6), parts=[
        ("cyl", (-10.0, 2.6, 17.0, 2.6), 3.2, "olive"), ("cyl", (15.0, 2.6, 19.0, 2.6), 3.8, "olive_d"), ("cyl", (-11.0, 2.6, -8.0, 2.6), 3.6, "olive_d"),
        ("box", (2.0, 5.2, 5.4, 7.6), 1.6, "gun_dark"), ("box", (0.6, -4.4, 3.0, 0.0), 1.6, "gun_dark")]),
    "F": dict(m=(20.0, 2.0), parts=[
        ("box", (-2.0, 0.0, 14.0, 4.2), 2.6, "gun_dark"), ("cyl", (14.0, 2.0, 19.5, 2.0), 1.2, "red"), ("cyl", (0.5, -3.0, 8.5, -3.0), 2.6, "orange"),
        ("box", (1.0, 4.0, 11.0, 5.2), 2.0, "gun_mid"), ("box", (19.0, 1.0, 20.2, 3.0), 1.4, "gun_light")]),
    "S": dict(m=(20.0, 2.0), parts=[
        ("box", (-8.5, -1.4, -1.0, 2.4), 2.0, "wood"), ("box", (-1.0, 0.0, 7.0, 3.4), 2.4, "gun_dark"), ("cyl", (7.0, 2.4, 20.0, 2.4), 1.1, "gun_mid"),
        ("cyl", (7.0, 0.6, 18.0, 0.6), 0.9, "gun_dark"), ("box", (9.0, -1.4, 14.5, 0.6), 2.4, "pump")]),
    "L": dict(m=(18.0, 2.0), parts=[
        ("box", (-3.0, -1.2, 12.0, 4.4), 2.8, "gun_dark"), ("box", (1.0, 1.0, 10.0, 3.2), 3.0, "laser"), ("cyl", (12.0, 2.0, 16.0, 2.0), 1.8, "gun_light"),
        ("cyl", (16.0, 2.0, 17.6, 2.0), 1.0, "laser_tip"), ("box", (2.0, -5.4, 5.0, -1.0), 1.8, "gun_mid")]),
}
def build_guns():
    out = {}
    for gid, G in GUNS.items():
        root = link(bpy.data.objects.new("gun_" + gid, None))
        for kind, (x0, z0, x1, z1), dep, mn in G["parts"]:
            if kind == "box":
                ob = prim("box", gid, mn, ((x0 + x1) / 2 * GS, 0, (z0 + z1) / 2 * GS), scale=((x1 - x0) * GS, dep * GS, (z1 - z0) * GS), bevel=0.004)
            else:
                L = math.hypot(x1 - x0, z1 - z0) * GS
                ob = prim("cyl", gid, mn, ((x0 + x1) / 2 * GS, 0, (z0 + z1) / 2 * GS), scale=(dep * GS, dep * GS, L), rot=(0, math.atan2(x1 - x0, z1 - z0), 0), seg=16)
            ob.parent = root
        out[gid] = root
    knife = link(bpy.data.objects.new("gun_knife", None))
    prim("box", "blade", "steel", (0.11, 0, 0.005), scale=(0.17, 0.006, 0.03), bevel=0.002).parent = knife
    prim("box", "hilt", "gun_dark", (0.0, 0, 0.0), scale=(0.03, 0.025, 0.08), bevel=0.004).parent = knife
    out["knife"] = knife
    gren = link(bpy.data.objects.new("gun_grenade", None))
    prim("sphere", "gren", "olive", (0, 0, 0.03), scale=(0.07, 0.07, 0.08)).parent = gren
    prim("box", "pin", "gun_light", (0, 0, 0.08), scale=(0.02, 0.02, 0.02)).parent = gren
    out["grenade"] = gren
    return out

# ---------- rig: IK targets driven from the game's 2D skeleton ----------
EMP = {}
def empty(name, loc=(0, 0, 0)):
    e = link(bpy.data.objects.new(name, None)); e.location = loc; EMP[name] = e; return e

def rig(arm):
    pb = arm.pose.bones
    for b in pb: b.rotation_mode = "XYZ"
    c = pb["mixamorig:Hips"].constraints.new("COPY_LOCATION"); c.target = empty("hip_t"); c.name = "hipc"
    for side in ("Right", "Left"):
        c = pb[f"mixamorig:{side}Foot"].constraints.new("DAMPED_TRACK"); c.target = empty(f"{side}Toe_t"); c.track_axis = "TRACK_Y"
    for side in ("Right", "Left"):
        for limb, chain in (("Leg", "Foot"), ("ForeArm", "Hand")):
            ik = pb[f"mixamorig:{side}{limb}"].constraints.new("IK"); ik.name = "ik"
            ik.target = empty(f"{side}{limb}_t"); ik.pole_target = empty(f"{side}{limb}_p"); ik.chain_count = 2
            ik.pole_angle = -math.pi / 2
    arm.data.pose_position = "POSE"
    # pick each chain's pole angle so the middle joint actually points at its pole
    set_targets((0.0, 0.9), {"Right": ((0.1, 0.1), (0.8, 0.6)), "Left": ((0.1, 0.1), (0.8, 0.6))},
                {"Right": ((0.35, 1.2), (-0.4, 0.9)), "Left": ((0.35, 1.2), (-0.4, 0.9))})
    for side in ("Right", "Left"):
        for limb, mid in (("Leg", "Leg"), ("ForeArm", "ForeArm")):
            ik = pb[f"mixamorig:{side}{limb}"].constraints["ik"]; best = None
            for k in range(8):
                ik.pole_angle = k * math.pi / 4 - math.pi
                j = bone_world(arm, side + mid); pole = EMP[f"{side}{limb}_p"].location
                d = (j - pole).length
                if best is None or d < best[0]: best = (d, ik.pole_angle)
            ik.pole_angle = best[1]

def fist(arm, curl=1.2):
    for b in arm.pose.bones:
        n = b.name.split(":")[-1]
        if "Hand" in n and any(f in n for f in ("Index", "Middle", "Ring", "Pinky")): b.rotation_euler = (curl * 0.8, 0, 0)
        elif "HandThumb" in n: b.rotation_euler = (0.3, 0, 0.4)

def W(p): return Vector((p[0], 0.0, p[1]))     # 2D (forward, up) -> world on the mid plane
K_OLD = 0.0562                                  # old skeleton hi-px -> metres
ANK = 0.084                                     # ankle height of the rest pose

def set_targets(hip, feet=None, hands=None, spine=0.0, head=0.0):
    """hip: (x, z) of the hip joints' midpoint; feet: {side: (ankle xz, knee-pole xz)}; hands: {side: (hand xz, elbow-pole xz)}"""
    EMP["hip_t"].location = (hip[0], 0.0, hip[1] + 0.068)
    for side, y in (("Right", -0.085), ("Left", 0.085)):
        a, pole = feet[side][:2]; toe = feet[side][2] if len(feet[side]) > 2 else (a[0] + 0.13, a[1] - 0.075)
        EMP[side + "Leg_t"].location = (a[0], y, a[1]); EMP[side + "Leg_p"].location = (pole[0], y, pole[1])
        if side + "Toe_t" in EMP: EMP[side + "Toe_t"].location = (toe[0], y, toe[1])
    if hands:
        for side, y in (("Right", -0.2), ("Left", 0.2)):
            h, pole = hands[side]
            EMP[side + "ForeArm_t"].location = (h[0], y * 0.75, h[1]); EMP[side + "ForeArm_p"].location = (pole[0], y * 1.6, pole[1])
    return spine, head

def old_legs(pose, fr=0):
    """The game's leg skeleton (soldier.js) in metres: hip xz and ankle targets."""
    sk = skeleton_old(pose, fr)
    hip = (sk["hip"][0] * K_OLD, ANK + (sk["hip"][1] - 3.2) * K_OLD * 0.985)
    feet = {}
    for side, key in (("Right", "near"), ("Left", "far")):
        f = sk[key]["foot"]; a = (f[0] * K_OLD, ANK + f[1] * K_OLD)
        feet[side] = (a, ((hip[0] + a[0]) / 2 + 0.6, (hip[1] + a[1]) / 2 + 0.1))
    return hip, feet

def skeleton_old(pose, fr=0):     # same leg skeleton as js/soldier.js (hi-px)
    s = {"lean": 0}
    if pose == "cwalk":
        ph = fr / 8 * math.tau; s["hip"] = (0, 10.5 + (1 - math.cos(2 * ph)) * 0.5)
        foot = lambda th, x0: (x0 + 4.5 * math.cos(th), max(0, -math.sin(th)) * 3)
        s["near"] = {"foot": foot(ph, 7)}; s["far"] = {"foot": foot(ph + math.pi, -5)}
    elif pose == "jump": s["hip"] = (0, 19); s["near"] = {"foot": (7, 7)}; s["far"] = {"foot": (-5, 1)}
    elif pose == "apex": s["hip"] = (0, 20); s["near"] = {"foot": (6, 11)}; s["far"] = {"foot": (1, 9)}
    elif pose == "fall": s["hip"] = (0, 19); s["near"] = {"foot": (4, 1.5)}; s["far"] = {"foot": (-3, 3.5)}
    elif pose == "crouch": s["hip"] = (0, 10); s["near"] = {"foot": (9, 0)}; s["far"] = {"foot": (-11, 1.5)}
    elif pose == "roll": s["hip"] = (-1, 11); s["near"] = {"foot": (5, 4)}; s["far"] = {"foot": (3, 5.5)}
    else: s["hip"] = (0, 19); s["near"] = {"foot": (3, 0)}; s["far"] = {"foot": (-4, 0)}
    return s

STAND_HIP = None
def shoulder(arm):
    bpy.context.view_layer.update()
    return bone_world(arm, "RightArm")

def aim_rot(aim): return {"f": 0.0, "u": math.pi / 2, "d": -math.pi / 2}[aim]

def pose_upper(arm, kind, gid=None, aim="f", recoil=False, flail=0):
    """Upper-body pose on the standing legs; returns (gun object or None, its world matrix, muzzle world pos)."""
    hip, feet = old_legs("stand")
    pb = arm.pose.bones
    lean = {"gun": 0.08, "knife": 0.2, "throw": -0.1, "flail": -0.15, "tuck": 0.0, "idle": 0.03}[kind]
    if kind == "gun" and aim == "u": lean = -0.05
    for n in ("Spine", "Spine1", "Spine2"): pb["mixamorig:" + n].rotation_euler = (lean, 0, 0)
    pb["mixamorig:Head"].rotation_euler = ({"u": -0.35, "d": 0.3}.get(aim, -0.05) if kind == "gun" else 0.0, 0, 0)
    set_targets(hip, feet)
    sh = shoulder(arm); s = (sh.x, sh.z)
    hands, gun, gmat, muz = None, None, None, None
    if kind == "gun":
        a = aim_rot(aim); d = Vector((math.cos(a), 0, math.sin(a))); up = Vector((-math.sin(a), 0, math.cos(a)))
        one = GUNS[gid].get("one")
        if aim == "f": g = (s[0] + (0.48 if one else 0.30), s[1] - (0.03 if one else 0.16))
        elif aim == "u": g = (s[0] + 0.14, s[1] + 0.10)
        else: g = (s[0] + 0.20, s[1] - 0.26)
        if recoil: g = (g[0] - d.x * 0.035, g[1] - d.z * 0.035)
        sup = (g[0] + d.x * 0.17 - up.x * 0.02, g[1] + d.z * 0.17 - up.z * 0.02)
        far = (s[0] + 0.05, s[1] - 0.5) if one else sup
        hands = {"Right": (g, (s[0] - 0.2, s[1] - 0.45)), "Left": (far, (s[0] - 0.2, s[1] - 0.45))}
        gun = gid
        gmat = Matrix.Translation((g[0] + up.x * 0.01, -0.17, g[1] + up.z * 0.01)) @ Matrix.Rotation(-a, 4, "Y")
        m = GUNS[gid]["m"]; muz = gmat @ Vector((m[0] * GS, 0, m[1] * GS))
    elif kind == "knife":
        hands = {"Right": ((s[0] + 0.5, s[1] - 0.02), (s[0], s[1] - 0.4)), "Left": ((s[0] + 0.05, s[1] - 0.5), (s[0] - 0.2, s[1] - 0.4))}
        gun = "knife"; gmat = Matrix.Translation((s[0] + 0.53, -0.24, s[1] - 0.02))
    elif kind == "throw":
        hands = {"Right": ((s[0] - 0.2, s[1] + 0.3), (s[0] - 0.4, s[1])), "Left": ((s[0] + 0.3, s[1] - 0.1), (s[0], s[1] - 0.4))}
        gun = "grenade"; gmat = Matrix.Translation((s[0] - 0.22, -0.26, s[1] + 0.36))
    elif kind == "flail":
        k = 0.06 * flail
        hands = {"Right": ((s[0] + 0.12, s[1] + 0.45 - k), (s[0] + 0.4, s[1])), "Left": ((s[0] - 0.12, s[1] + 0.4 + k), (s[0] - 0.4, s[1]))}
    elif kind == "tuck":
        hands = {"Right": ((s[0] + 0.3, s[1] - 0.45), (s[0] - 0.3, s[1] - 0.3)), "Left": ((s[0] + 0.3, s[1] - 0.45), (s[0] - 0.3, s[1] - 0.3))}
    else:
        hands = {"Right": ((s[0] + 0.06, s[1] - 0.52), (s[0] - 0.3, s[1] - 0.25)), "Left": ((s[0] - 0.02, s[1] - 0.52), (s[0] - 0.3, s[1] - 0.25))}
    set_targets(hip, feet, hands)
    return gun, gmat, muz

def pose_legs(arm, pose, fr=0):
    for n in ("Spine", "Spine1", "Spine2", "Head"): arm.pose.bones["mixamorig:" + n].rotation_euler = (0, 0, 0)
    hip, feet = old_legs(pose, fr)
    set_targets(hip, feet, {"Right": ((0.1, hip[1] + 0.05), (-0.3, hip[1] + 0.3)), "Left": ((0.1, hip[1] + 0.05), (-0.3, hip[1] + 0.3))})

def no_action(arm):
    if arm.animation_data: arm.animation_data.action = None
    for b in arm.pose.bones:
        for c in b.constraints: c.mute = False
        b.rotation_mode = "XYZ"; b.location = (0, 0, 0); b.rotation_euler = (0, 0, 0)

def hip_anchor(arm):
    bpy.context.view_layer.update()
    return (bone_world(arm, "RightUpLeg") + bone_world(arm, "LeftUpLeg")) / 2

# ---------- scene, lights, camera ----------
def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True; sc.cycles.max_bounces = 4
    sc.render.resolution_x = sc.render.resolution_y = RES; sc.render.resolution_percentage = 100
    sc.render.film_transparent = True; sc.render.filter_size = 1.2
    sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
    cam = bpy.data.cameras.new("cam"); cam.type = "ORTHO"; cam.ortho_scale = RES / PPM
    co = link(bpy.data.objects.new("cam", cam)); sc.camera = co
    co.location = (0, -10, (RES / 2 - (RES - ORG_Y)) / PPM); co.rotation_euler = (math.pi / 2, 0, 0)
    cam.clip_start = 1; cam.clip_end = 30
    def sun(name, e, rot, col=(1, 1, 1), ang=0.05):
        l = bpy.data.lights.new(name, "SUN"); l.energy = e; l.color = col; l.angle = ang
        o = link(bpy.data.objects.new(name, l)); o.rotation_euler = rot
    sun("key", 4.2, (math.radians(-40), math.radians(-38), math.radians(-25)), (1.0, 0.96, 0.9))     # upper left, toward the camera
    sun("fill", 0.9, (math.radians(-65), math.radians(50), math.radians(30)), (0.8, 0.88, 1.0), 0.3)
    sun("rim", 3.0, (math.radians(-60), math.radians(60), math.radians(150)), (1.0, 0.92, 0.85))   # from behind: silhouette edge
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.45, 0.5, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 0.35
    return sc

def render(sc, objs):
    for o in bpy.data.objects:
        if o.type in ("MESH", "CURVE"): o.hide_render = o not in objs
    path = f"{TMP}/frame.png"; sc.render.filepath = path; sc.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    a = np.array(img.pixels[:], dtype=np.float32).reshape(RES, RES, 4)[::-1].copy()
    bpy.data.images.remove(img)
    return a

def to_px(p):   # world point -> render pixel (x right, y down)
    return (RES / 2 + p.x * PPM, ORG_Y - p.z * PPM)

def outline(a):
    """Thin dark rim around the silhouette so the hero reads on busy backgrounds."""
    al = a[..., 3]; grow = al.copy()
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (-1, -1), (1, -1), (-1, 1)):
        grow = np.maximum(grow, np.roll(np.roll(al, dy, 0), dx, 1) * (0.8 if dx and dy else 1.0))
    rim = np.clip(grow - al, 0, 1) * 0.75
    out = a.copy()
    rgb_p = a[..., :3] * al[..., None] + np.array([0.06, 0.04, 0.035]) * rim[..., None]   # premultiplied over
    alpha = al + rim * (1 - al)
    out[..., :3] = np.where(alpha[..., None] > 0, rgb_p / np.maximum(alpha, 1e-6)[..., None], 0); out[..., 3] = alpha
    return out

# ---------- main ----------
def main():
    sc = setup(); make_materials()
    arm, root, body = build_body()
    physique(arm)
    head = build_head(arm)
    gear_up, gear_lo = build_gear(arm, body)
    guns = build_guns()
    rig(arm); fist(arm)
    gun_objs = {k: [c for c in g.children] for k, g in guns.items()}
    upper_set = [body["upper"]] + head + gear_up
    lower_set = [body["lower"]] + gear_lo
    pals = costumes(); ncost = 1 if QUICK else len(pals)
    frames = {}     # name -> dict(imgs=[per costume RGBA], ox, oy, extra)
    def shot(name, objs, origin_world, extra=None):
        bpy.context.view_layer.update()
        imgs = []
        for ci in range(ncost):
            set_costume(pals[ci]); imgs.append(outline(render(sc, objs)))
        ox, oy = to_px(origin_world)
        frames[name] = dict(imgs=imgs, ox=ox, oy=oy, extra=extra or [])
        print("frame", name, flush=True)
    ground = Vector((0, 0, 0))
    # legs layer: origin = the feet (ground under the root); extra = hip anchor (world px, x fwd, y up)
    leg_poses = [("stand", 0), ("jump", 0), ("fall", 0), ("crouch", 0), ("apex", 0)] + [("cwalk", f) for f in range(8)]
    if QUICK: leg_poses = [("stand", 0), ("crouch", 0)]
    for pose, f in leg_poses:
        no_action(arm); fist(arm); pose_legs(arm, pose, f)
        h = hip_anchor(arm)
        shot("L_" + pose + (str(f) if pose == "cwalk" else ""), lower_set, ground, [round(h.x * M, 2), round(h.z * M, 2)])
    for f in range(2 if QUICK else 12):     # mocap run (sampled joint positions), 12 frames
        no_action(arm); fist(arm); J = RUN[f]
        xz = lambda v: (v.x, v.z)
        mid = (J["RightUpLeg"] + J["LeftUpLeg"]) / 2
        feet = {}
        for side in ("Right", "Left"):
            hp, kn, an = J[side + "UpLeg"], J[side + "Leg"], J[side + "Foot"]
            pole = kn + (kn - (hp + an) / 2).normalized() * 0.5
            feet[side] = (xz(an), xz(pole), xz(J[side + "ToeBase"]))
        set_targets(xz(mid), feet, {"Right": ((mid.x + 0.1, mid.z + 0.05), (mid.x - 0.3, mid.z + 0.3)), "Left": ((mid.x + 0.1, mid.z + 0.05), (mid.x - 0.3, mid.z + 0.3))})
        h = hip_anchor(arm)
        shot(f"L_run{f}", lower_set, ground, [round(h.x * M, 2), round(h.z * M, 2)])
    no_action(arm)
    # upper layer: origin = hip anchor; extra = muzzle (world px from the hip, x fwd, y up)
    ups = [(gid, aim, rc) for gid in GUNS for aim in ("f", "u", "d") for rc in (False, True)]
    if QUICK: ups = [("H", "f", False), ("pistol", "f", False), ("S", "u", False), ("L", "d", False)]
    def place_gun(gid, gmat):
        for k, g in guns.items(): g.matrix_world = Matrix.Translation((0, 50, 0))
        if gid: guns[gid].matrix_world = gmat
        return gun_objs[gid] if gid else []
    for gid, aim, rc in ups:
        no_action(arm); fist(arm)
        g, gmat, muz = pose_upper(arm, "gun", gid, aim, rc)
        h = hip_anchor(arm); objs = upper_set + place_gun(g, gmat)
        shot(f"U_{gid}_{aim}{'r' if rc else ''}", objs, h, [round((muz.x - h.x) * M, 2), round((muz.z - h.z) * M, 2)])
    for kind, name, fl in ([("knife", "U_knife", 0), ("throw", "U_throw", 0), ("idle", "U_idle", 0), ("flail", "U_flail0", 0), ("flail", "U_flail1", 1)] if not QUICK else [("idle", "U_idle", 0)]):
        no_action(arm); fist(arm)
        g, gmat, _ = pose_upper(arm, kind, flail=fl)
        h = hip_anchor(arm)
        shot(name, upper_set + place_gun(g, gmat), h)
    place_gun(None, None)
    # roll: tucked ball, turned about its centre, resting on the ground
    for k in range(2 if QUICK else 8):
        no_action(arm); fist(arm)
        hip, feet = old_legs("roll")
        pb = arm.pose.bones
        for n in ("Spine", "Spine1", "Spine2"): pb["mixamorig:" + n].rotation_euler = (0.55, 0, 0)
        pb["mixamorig:Head"].rotation_euler = (0.5, 0, 0)
        set_targets(hip, feet)
        sh = shoulder(arm); s = (sh.x, sh.z)
        set_targets(hip, feet, {"Right": ((s[0] + 0.25, s[1] - 0.35), (s[0] - 0.3, s[1] - 0.2)), "Left": ((s[0] + 0.25, s[1] - 0.35), (s[0] - 0.3, s[1] - 0.2))})
        root.matrix_world = Matrix.Rotation(math.pi / 2, 4, "Z")
        bpy.context.view_layer.update()
        objs = upper_set + lower_set
        pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
        cx = 0.5 * (min(p.x for p in pts) + max(p.x for p in pts)); cz = 0.5 * (min(p.z for p in pts) + max(p.z for p in pts))
        rot = Matrix.Translation((cx, 0, cz)) @ Matrix.Rotation(-k / 8 * math.tau, 4, "Y") @ Matrix.Translation((-cx, 0, -cz))
        root.matrix_world = rot @ Matrix.Rotation(math.pi / 2, 4, "Z")
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        zmin = min((o.matrix_world @ v.co).z for o in (body["upper"], body["lower"]) for v in o.evaluated_get(dg).to_mesh().vertices)
        root.matrix_world = Matrix.Translation((0, 0, -zmin)) @ root.matrix_world
        shot(f"R_roll{k}", objs, ground)
        root.matrix_world = Matrix.Rotation(math.pi / 2, 4, "Z")
    write(frames, ncost)
    if "--preview" in sys.argv: preview(frames, sys.argv[sys.argv.index("--preview") + 1])

def crop_box(frames):
    for f in frames.values():
        al = np.max([im[..., 3] for im in f["imgs"]], 0) > 0.02
        ys, xs = np.nonzero(al)
        f["box"] = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)

def pack(frames):
    """Shelf-pack the cropped frames, tallest first, 1 px gutters."""
    order = sorted(frames, key=lambda n: -(frames[n]["box"][3] - frames[n]["box"][1]))
    width = 1024; x = y = shelf = 0; pos = {}
    for n in order:
        x0, y0, x1, y1 = frames[n]["box"]; w, h = x1 - x0, y1 - y0
        if x + w > width: x = 0; y += shelf + 1; shelf = 0
        pos[n] = (x, y); x += w + 1; shelf = max(shelf, h)
    return pos, width, y + shelf

def write(frames, ncost):
    crop_box(frames); pos, aw, ah = pack(frames)
    os.makedirs(os.path.join(ROOT, "img"), exist_ok=True)
    table = {}
    for n, f in frames.items():
        x0, y0, x1, y1 = f["box"]; px, py = pos[n]
        table[n] = [int(px), int(py), int(x1 - x0), int(y1 - y0), round(f["ox"] - x0, 2), round(f["oy"] - y0, 2)] + f["extra"]
    for ci in range(ncost):
        atlas = np.zeros((ah, aw, 4), np.float32)
        for n, f in frames.items():
            x0, y0, x1, y1 = f["box"]; px, py = pos[n]
            atlas[py:py + y1 - y0, px:px + x1 - x0] = f["imgs"][ci][y0:y1, x0:x1]
        save_webp(atlas, os.path.join(ROOT, "img", f"rayo_{ci}.webp"))
    js = ("\"use strict\";\n// Generated by slugger/art/hero.py from the Blender scene; do not edit by hand.\n"
          "// Full-colour hero frames, one atlas per costume. Frame: [x, y, w, h, originX, originY, ...extra] in atlas px;\n"
          "// R atlas px per world px. Legs (L_*): origin = feet, extra = hip [x, up] in world px. Upper (U_*): origin = hip,\n"
          "// extra = muzzle [x, up] in world px from the hip. Roll (R_*): origin = feet.\n"
          f"const HERO_ART = {{ head: \"h_rayo\", R: {R}, atlas: \"img/rayo_\", costumes: {ncost},\n"
          f"  frames: {json.dumps(table, separators=(',', ':'))} }};\n")
    open(os.path.join(ROOT, "js", "hero_art.js"), "w").write(js)
    print("wrote hero_art.js +", ncost, "atlases", aw, "x", ah, len(frames), "frames")

def save_webp(a, path):
    h, w = a.shape[:2]
    img = bpy.data.images.new("atlas", w, h, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(a[::-1].reshape(-1))
    sc = bpy.context.scene; vs = sc.view_settings; keep = (vs.view_transform, vs.look)
    vs.view_transform = "Standard"; vs.look = "None"          # the pixels are already display-ready
    st = sc.render.image_settings
    st.file_format = "WEBP"; st.color_mode = "RGBA"; st.quality = 88
    img.save_render(path, scene=sc)
    vs.view_transform, vs.look = keep; st.file_format = "PNG"
    bpy.data.images.remove(img)
    print("atlas", path, os.path.getsize(path), "bytes")

# ---------- preview sheet: a few composed poses, costume 0 ----------
def preview(frames, out):
    def comp(lo, up, x0=60, y0=150, S=200):
        img = np.zeros((S, 150, 4), np.float32)
        def put(f, x, y):
            im = f["imgs"][0]; bx0, by0, bx1, by1 = f["box"]
            X, Y = int(round(x - (f["ox"] - bx0))), int(round(y - (f["oy"] - by0)))
            src = im[by0:by1, bx0:bx1]; h, w = src.shape[:2]
            ys, xs = slice(max(0, Y), min(S, Y + h)), slice(max(0, X), min(150, X + w))
            s = src[ys.start - Y:ys.stop - Y, xs.start - X:xs.stop - X]
            d = img[ys, xs]; a = s[..., 3:4]
            d[..., :3] = s[..., :3] * a + d[..., :3] * (1 - a); d[..., 3:4] = a + d[..., 3:4] * (1 - a)
        L = frames[lo]; put(L, x0, y0)
        if up:
            hx, hy = L["extra"][0] * R, L["extra"][1] * R
            put(frames[up], x0 + hx, y0 - hy)
        return img
    names = [n for n in frames]
    combos = []
    for lo in [n for n in names if n.startswith("L_")]:
        ups = [n for n in names if n.startswith("U_") and not n.endswith("r")]
        combos.append((lo, ups[len(combos) % len(ups)]))
    combos += [(n, None) for n in names if n.startswith("R_")]
    tiles = [comp(a, b) for a, b in combos]
    while len(tiles) % 6: tiles.append(np.zeros_like(tiles[0]))
    rows = [np.concatenate(tiles[i:i + 6], 1) for i in range(0, len(tiles), 6)]
    sheet = np.concatenate(rows, 0)
    bg = np.array([0.47, 0.63, 0.75])
    rgb = sheet[..., :3] * sheet[..., 3:4] + bg * (1 - sheet[..., 3:4])
    save_png(np.clip(rgb, 0, 1), out)

def save_png(rgb, path):
    h, w = rgb.shape[:2]
    a = np.concatenate([rgb, np.ones((h, w, 1))], -1).astype(np.float32)
    img = bpy.data.images.new("prev", w, h, alpha=True); img.pixels.foreach_set(a[::-1].reshape(-1))
    img.filepath_raw = path; img.file_format = "PNG"; img.save(); bpy.data.images.remove(img)

if __name__ == "__main__":
    main()
