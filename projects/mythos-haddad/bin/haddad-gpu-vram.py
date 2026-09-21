#!/usr/bin/env python3
"""Mythos Haddad — live GPU VRAM usage (Vulkan VK_EXT_memory_budget).

No dependencies, no root, no nvidia-smi (there isn't one — this GPU runs on
the open nouveau/NVK stack, and nouveau exposes no VRAM sysfs counter
without debugfs, which needs root). VK_EXT_memory_budget gives the same
number the driver itself uses: system-wide heap usage, not just this
process's allocations, chained onto vkGetPhysicalDeviceMemoryProperties2.

Prints one JSON object: {"vram_total_mib", "vram_used_mib", "vram_used_pct"}
summed over every DEVICE_LOCAL heap on the first hardware GPU. Exit 0 on
success, 2 if no hardware GPU or the extension is unavailable.

KNOWN LIMITATION (verified on haddad, 2026-09-21): NVK does not yet
populate heapUsage — vram_used_mib reads 0 even with ~4.4 GB genuinely
resident on the GPU (a model loaded and actively serving). vram_total_mib
is correct (matches the driver's own heap size). Not used by
haddad-health.js's ai_runtime check for this reason; see
docs/AI_RUNTIME.md, Measurements, for how VRAM use was actually measured.
Kept here since heapBudget/total is still useful, and this may start
reporting real usage in a future Mesa/NVK release.
"""
import ctypes as C
import json
import sys

u32, u64, i32, vp = C.c_uint32, C.c_uint64, C.c_int32, C.c_void_p


def S(name, fields):
    return type(name, (C.Structure,), {"_fields_": fields})


AppInfo = S("AppInfo", [("sType", u32), ("pNext", vp), ("pApplicationName", C.c_char_p), ("applicationVersion", u32),
                        ("pEngineName", C.c_char_p), ("engineVersion", u32), ("apiVersion", u32)])
InstanceCI = S("InstanceCI", [("sType", u32), ("pNext", vp), ("flags", u32), ("pApplicationInfo", C.POINTER(AppInfo)),
                              ("enabledLayerCount", u32), ("ppEnabledLayerNames", vp),
                              ("enabledExtensionCount", u32), ("ppEnabledExtensionNames", vp)])
ExtProps = S("ExtProps", [("extensionName", C.c_char * 256), ("specVersion", u32)])
MemBudget = S("MemBudget", [("sType", u32), ("pNext", vp), ("heapBudget", u64 * 16), ("heapUsage", u64 * 16)])
MemType = S("MemType", [("propertyFlags", u32), ("heapIndex", u32)])
MemHeap = S("MemHeap", [("size", u64), ("flags", u32)])
MemProps2Inner = S("MemProps2Inner", [("memoryTypeCount", u32), ("memoryTypes", MemType * 32),
                                      ("memoryHeapCount", u32), ("memoryHeaps", MemHeap * 16)])
MemProps2 = S("MemProps2", [("sType", u32), ("pNext", vp), ("memoryProperties", MemProps2Inner)])

DEVICE_TYPES = {1: "integrated", 2: "discrete"}
HEAP_DEVICE_LOCAL = 1


def finish(result, code):
    print(json.dumps(result, indent=2))
    sys.exit(code)


def main():
    try:
        vk = C.CDLL("libvulkan.so.1")
    except OSError as e:
        finish({"error": "Vulkan loader not found: %s" % e}, 2)

    def fn(name, *argtypes, void=False):
        f = getattr(vk, name)
        f.argtypes = list(argtypes)
        f.restype = None if void else i32
        return f

    app = AppInfo(0, None, b"mythos-haddad-vram-probe", 1, b"none", 1, (1 << 22) | (1 << 12))
    ici = InstanceCI(1, None, 0, C.pointer(app), 0, None, 0, None)
    inst = vp()
    fn("vkCreateInstance", C.POINTER(InstanceCI), vp, C.POINTER(vp))(C.byref(ici), None, C.byref(inst))

    enum = fn("vkEnumeratePhysicalDevices", vp, C.POINTER(u32), C.POINTER(vp))
    n = u32(0)
    enum(inst, C.byref(n), None)
    devs = (vp * max(n.value, 1))()
    if n.value:
        enum(inst, C.byref(n), devs)

    get_props = fn("vkGetPhysicalDeviceProperties", vp, vp, void=True)
    get_ext = fn("vkEnumerateDeviceExtensionProperties", vp, vp, C.POINTER(u32), C.POINTER(ExtProps))
    phys = None
    for i in range(n.value):
        buf = C.create_string_buffer(2048)
        get_props(devs[i], buf)
        dtype = C.cast(buf, C.POINTER(u32 * 5)).contents[4]
        if dtype in (1, 2):
            en = u32(0)
            get_ext(devs[i], None, C.byref(en), None)
            exts = (ExtProps * en.value)()
            get_ext(devs[i], None, C.byref(en), exts)
            names = {e.extensionName.decode(errors="replace") for e in exts}
            # vkGetPhysicalDeviceMemoryProperties2 itself is core since Vulkan 1.1 (we request
            # 1.4), so it is never listed as a device extension name — only VK_EXT_memory_budget
            # (which is genuinely optional) needs to be checked here.
            if "VK_EXT_memory_budget" in names:
                phys = devs[i]
                break
    if phys is None:
        finish({"error": "no hardware GPU with VK_EXT_memory_budget"}, 2)

    get_props2 = fn("vkGetPhysicalDeviceMemoryProperties2", vp, vp, void=True)
    budget = MemBudget(1000237002, None, (u64 * 16)(), (u64 * 16)())  # VK_STRUCTURE_TYPE_..._BUDGET_PROPERTIES_EXT
    props2 = MemProps2(1000059002, C.cast(C.pointer(budget), vp), MemProps2Inner())  # ..._MEMORY_PROPERTIES_2
    get_props2(phys, C.byref(props2))

    mp = props2.memoryProperties
    total = used = 0
    for i in range(mp.memoryHeapCount):
        if mp.memoryHeaps[i].flags & HEAP_DEVICE_LOCAL:
            total += mp.memoryHeaps[i].size
            used += budget.heapUsage[i]

    mib = 1024 * 1024
    finish({
        "vram_total_mib": round(total / mib, 1),
        "vram_used_mib": round(used / mib, 1),
        "vram_used_pct": round(100.0 * used / total, 1) if total else None,
    }, 0)


if __name__ == "__main__":
    main()
