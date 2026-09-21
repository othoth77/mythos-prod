#!/usr/bin/env python3
"""Mythos Haddad V0 - basic GPU test (Vulkan, zero dependencies).

Talks to libvulkan.so.1 through ctypes, so it needs no SDK, headers, pip
packages or root. It refuses software rasterizers (llvmpipe): the test only
passes when work really executed on a hardware GPU.

What it does on the first hardware GPU:
  1. fill:      vkCmdFillBuffer writes a pattern into a DEVICE_LOCAL (VRAM)
                buffer, the GPU copies it to a host-visible buffer, the CPU
                verifies every word.
  2. roundtrip: random host data -> VRAM -> second host buffer, compared
                byte for byte.

Prints one JSON object on stdout. Exit code 0 = PASS, 1 = FAIL, 2 = no
usable GPU / Vulkan loader.
"""
import ctypes as C
import json
import os
import sys
import time

SIZE = int(os.environ.get("HADDAD_GPU_TEST_MIB", "64")) * 1024 * 1024
PATTERN = 0xC0DEF00D

u32, u64, vp = C.c_uint32, C.c_uint64, C.c_void_p


def S(name, fields):
    return type(name, (C.Structure,), {"_fields_": fields})


AppInfo = S("AppInfo", [("sType", u32), ("pNext", vp), ("pApplicationName", C.c_char_p), ("applicationVersion", u32),
                        ("pEngineName", C.c_char_p), ("engineVersion", u32), ("apiVersion", u32)])
InstanceCI = S("InstanceCI", [("sType", u32), ("pNext", vp), ("flags", u32), ("pApplicationInfo", C.POINTER(AppInfo)),
                              ("enabledLayerCount", u32), ("ppEnabledLayerNames", vp),
                              ("enabledExtensionCount", u32), ("ppEnabledExtensionNames", vp)])
QueueFamilyProps = S("QueueFamilyProps", [("queueFlags", u32), ("queueCount", u32), ("timestampValidBits", u32),
                                          ("minImageTransferGranularity", u32 * 3)])
QueueCI = S("QueueCI", [("sType", u32), ("pNext", vp), ("flags", u32), ("queueFamilyIndex", u32),
                        ("queueCount", u32), ("pQueuePriorities", C.POINTER(C.c_float))])
DeviceCI = S("DeviceCI", [("sType", u32), ("pNext", vp), ("flags", u32), ("queueCreateInfoCount", u32),
                          ("pQueueCreateInfos", C.POINTER(QueueCI)), ("enabledLayerCount", u32),
                          ("ppEnabledLayerNames", vp), ("enabledExtensionCount", u32),
                          ("ppEnabledExtensionNames", vp), ("pEnabledFeatures", vp)])
MemType = S("MemType", [("propertyFlags", u32), ("heapIndex", u32)])
MemHeap = S("MemHeap", [("size", u64), ("flags", u32)])
MemProps = S("MemProps", [("memoryTypeCount", u32), ("memoryTypes", MemType * 32),
                          ("memoryHeapCount", u32), ("memoryHeaps", MemHeap * 16)])
BufferCI = S("BufferCI", [("sType", u32), ("pNext", vp), ("flags", u32), ("size", u64), ("usage", u32),
                          ("sharingMode", u32), ("queueFamilyIndexCount", u32), ("pQueueFamilyIndices", vp)])
MemReq = S("MemReq", [("size", u64), ("alignment", u64), ("memoryTypeBits", u32)])
MemAI = S("MemAI", [("sType", u32), ("pNext", vp), ("allocationSize", u64), ("memoryTypeIndex", u32)])
PoolCI = S("PoolCI", [("sType", u32), ("pNext", vp), ("flags", u32), ("queueFamilyIndex", u32)])
CmdAI = S("CmdAI", [("sType", u32), ("pNext", vp), ("commandPool", u64), ("level", u32), ("commandBufferCount", u32)])
CmdBegin = S("CmdBegin", [("sType", u32), ("pNext", vp), ("flags", u32), ("pInheritanceInfo", vp)])
BufferCopy = S("BufferCopy", [("srcOffset", u64), ("dstOffset", u64), ("size", u64)])
SubmitInfo = S("SubmitInfo", [("sType", u32), ("pNext", vp), ("waitSemaphoreCount", u32), ("pWaitSemaphores", vp),
                              ("pWaitDstStageMask", vp), ("commandBufferCount", u32), ("pCommandBuffers", C.POINTER(vp)),
                              ("signalSemaphoreCount", u32), ("pSignalSemaphores", vp)])

DEVICE_TYPES = {0: "other", 1: "integrated", 2: "discrete", 3: "virtual", 4: "cpu"}
USAGE_SRC, USAGE_DST = 1, 2
MEM_DEVICE_LOCAL, MEM_HOST_VISIBLE, MEM_HOST_COHERENT = 1, 2, 4


def finish(result, code):
    print(json.dumps(result, indent=2))
    sys.exit(code)


def main():
    result = {"test": "mythos-haddad-gpu-vulkan", "size_mib": SIZE // (1024 * 1024), "status": "FAIL"}
    try:
        vk = C.CDLL("libvulkan.so.1")
    except OSError as e:
        result["error"] = "Vulkan loader not found: %s" % e
        finish(result, 2)

    def fn(name, *argtypes, void=False):
        f = getattr(vk, name)
        f.argtypes = list(argtypes)
        f.restype = None if void else C.c_int32
        return f

    def check(code, what):
        if code != 0:
            raise RuntimeError("%s failed with VkResult %d" % (what, code))

    app = AppInfo(0, None, b"mythos-haddad-gpu-test", 1, b"none", 1, (1 << 22) | (1 << 12))
    ici = InstanceCI(1, None, 0, C.pointer(app), 0, None, 0, None)
    inst = vp()
    check(fn("vkCreateInstance", C.POINTER(InstanceCI), vp, C.POINTER(vp))(C.byref(ici), None, C.byref(inst)),
          "vkCreateInstance")

    enum = fn("vkEnumeratePhysicalDevices", vp, C.POINTER(u32), C.POINTER(vp))
    n = u32(0)
    check(enum(inst, C.byref(n), None), "vkEnumeratePhysicalDevices")
    devs = (vp * max(n.value, 1))()
    if n.value:
        check(enum(inst, C.byref(n), devs), "vkEnumeratePhysicalDevices")

    get_props = fn("vkGetPhysicalDeviceProperties", vp, vp, void=True)
    found, phys = [], None
    for i in range(n.value):
        buf = C.create_string_buffer(2048)
        get_props(devs[i], buf)
        api, _drv, vendor, device, dtype = C.cast(buf, C.POINTER(u32 * 5)).contents
        info = {"name": buf.raw[20:276].split(b"\0")[0].decode(errors="replace"),
                "vendor_id": hex(vendor), "device_id": hex(device), "type": DEVICE_TYPES.get(dtype, str(dtype)),
                "vulkan_api": "%d.%d.%d" % (api >> 22, (api >> 12) & 0x3FF, api & 0xFFF)}
        found.append(info)
        if phys is None and dtype in (1, 2):
            phys, result["device"] = vp(devs[i]), info
    result["devices_found"] = found
    if phys is None:
        result["error"] = "no hardware Vulkan GPU found (software rasterizers are not accepted)"
        finish(result, 2)

    get_qf = fn("vkGetPhysicalDeviceQueueFamilyProperties", vp, C.POINTER(u32), C.POINTER(QueueFamilyProps), void=True)
    qn = u32(0)
    get_qf(phys, C.byref(qn), None)
    qprops = (QueueFamilyProps * qn.value)()
    get_qf(phys, C.byref(qn), qprops)
    family = next((i for i in range(qn.value) if qprops[i].queueFlags & 0x7 and qprops[i].queueCount), None)
    if family is None:
        raise RuntimeError("no graphics/compute/transfer queue family")

    prio = C.c_float(1.0)
    qci = QueueCI(2, None, 0, family, 1, C.pointer(prio))
    dci = DeviceCI(3, None, 0, 1, C.pointer(qci), 0, None, 0, None, None)
    dev = vp()
    check(fn("vkCreateDevice", vp, C.POINTER(DeviceCI), vp, C.POINTER(vp))(phys, C.byref(dci), None, C.byref(dev)),
          "vkCreateDevice")
    queue = vp()
    fn("vkGetDeviceQueue", vp, u32, u32, C.POINTER(vp), void=True)(dev, family, 0, C.byref(queue))

    mprops = MemProps()
    fn("vkGetPhysicalDeviceMemoryProperties", vp, C.POINTER(MemProps), void=True)(phys, C.byref(mprops))
    result["vram_mib"] = sum(mprops.memoryHeaps[i].size for i in range(mprops.memoryHeapCount)
                             if mprops.memoryHeaps[i].flags & 1) // (1024 * 1024)

    create_buffer = fn("vkCreateBuffer", vp, C.POINTER(BufferCI), vp, C.POINTER(u64))
    get_req = fn("vkGetBufferMemoryRequirements", vp, u64, C.POINTER(MemReq), void=True)
    alloc = fn("vkAllocateMemory", vp, C.POINTER(MemAI), vp, C.POINTER(u64))
    bind = fn("vkBindBufferMemory", vp, u64, u64, u64)
    map_mem = fn("vkMapMemory", vp, u64, u64, u64, u32, C.POINTER(vp))

    def make_buffer(want, avoid=0):
        bci = BufferCI(12, None, 0, SIZE, USAGE_SRC | USAGE_DST, 0, 0, None)
        b = u64()
        check(create_buffer(dev, C.byref(bci), None, C.byref(b)), "vkCreateBuffer")
        req = MemReq()
        get_req(dev, b, C.byref(req))
        for strict in (True, False):
            for i in range(mprops.memoryTypeCount):
                flags = mprops.memoryTypes[i].propertyFlags
                if req.memoryTypeBits & (1 << i) and flags & want == want and not (strict and flags & avoid):
                    mai, m = MemAI(5, None, req.size, i), u64()
                    check(alloc(dev, C.byref(mai), None, C.byref(m)), "vkAllocateMemory")
                    check(bind(dev, b, m, 0), "vkBindBufferMemory")
                    return b, m, flags
        raise RuntimeError("no memory type with flags %#x" % want)

    # VRAM buffer: DEVICE_LOCAL and, when possible, not CPU-visible.
    dev_buf, _dev_mem, dev_flags = make_buffer(MEM_DEVICE_LOCAL, avoid=MEM_HOST_VISIBLE)
    host_a, mem_a, _ = make_buffer(MEM_HOST_VISIBLE | MEM_HOST_COHERENT)
    host_b, mem_b, _ = make_buffer(MEM_HOST_VISIBLE | MEM_HOST_COHERENT)
    result["device_buffer_cpu_visible"] = bool(dev_flags & MEM_HOST_VISIBLE)
    ptr_a, ptr_b = vp(), vp()
    check(map_mem(dev, mem_a, 0, SIZE, 0, C.byref(ptr_a)), "vkMapMemory")
    check(map_mem(dev, mem_b, 0, SIZE, 0, C.byref(ptr_b)), "vkMapMemory")

    pool = u64()
    pci = PoolCI(39, None, 0x2, family)  # RESET_COMMAND_BUFFER
    check(fn("vkCreateCommandPool", vp, C.POINTER(PoolCI), vp, C.POINTER(u64))(dev, C.byref(pci), None, C.byref(pool)),
          "vkCreateCommandPool")
    cmd = vp()
    cai = CmdAI(40, None, pool.value, 0, 1)
    check(fn("vkAllocateCommandBuffers", vp, C.POINTER(CmdAI), C.POINTER(vp))(dev, C.byref(cai), C.byref(cmd)),
          "vkAllocateCommandBuffers")

    begin = fn("vkBeginCommandBuffer", vp, C.POINTER(CmdBegin))
    end = fn("vkEndCommandBuffer", vp)
    fill = fn("vkCmdFillBuffer", vp, u64, u64, u64, u32, void=True)
    copy = fn("vkCmdCopyBuffer", vp, u64, u64, u32, C.POINTER(BufferCopy), void=True)
    submit = fn("vkQueueSubmit", vp, u32, C.POINTER(SubmitInfo), u64)
    wait = fn("vkQueueWaitIdle", vp)
    region = BufferCopy(0, 0, SIZE)

    def run(record):
        bi = CmdBegin(42, None, 0x1, None)  # ONE_TIME_SUBMIT
        check(begin(cmd, C.byref(bi)), "vkBeginCommandBuffer")
        record()
        check(end(cmd), "vkEndCommandBuffer")
        cmds = (vp * 1)(cmd)
        si = SubmitInfo(4, None, 0, None, None, 1, cmds, 0, None)
        t0 = time.perf_counter()
        check(submit(queue, 1, C.byref(si), 0), "vkQueueSubmit")
        check(wait(queue), "vkQueueWaitIdle")
        return time.perf_counter() - t0

    mib = SIZE / (1024 * 1024)

    # 1. fill on the GPU, read back, verify every word.
    C.memset(ptr_a, 0, SIZE)
    secs = run(lambda: (fill(cmd, dev_buf, 0, SIZE, PATTERN), copy(cmd, dev_buf, host_a, 1, C.byref(region))))
    got = C.string_at(ptr_a, SIZE)
    fill_ok = got == PATTERN.to_bytes(4, "little") * (SIZE // 4)
    result["fill"] = {"ok": fill_ok, "pattern": hex(PATTERN), "gpu_seconds": round(secs, 4),
                      "mib_per_s": round(mib / secs, 1)}

    # 2. random data host -> VRAM -> host, compare.
    data = os.urandom(SIZE)
    C.memmove(ptr_a, data, SIZE)
    C.memset(ptr_b, 0, SIZE)
    secs = run(lambda: (copy(cmd, host_a, dev_buf, 1, C.byref(region)), copy(cmd, dev_buf, host_b, 1, C.byref(region))))
    rt_ok = C.string_at(ptr_b, SIZE) == data
    result["roundtrip"] = {"ok": rt_ok, "gpu_seconds": round(secs, 4), "mib_per_s": round(2 * mib / secs, 1)}

    check(fn("vkDeviceWaitIdle", vp)(dev), "vkDeviceWaitIdle")
    fn("vkDestroyDevice", vp, vp, void=True)(dev, None)  # frees all child objects' device memory
    fn("vkDestroyInstance", vp, vp, void=True)(inst, None)

    result["status"] = "PASS" if fill_ok and rt_ok else "FAIL"
    finish(result, 0 if result["status"] == "PASS" else 1)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - report every failure as JSON
        finish({"test": "mythos-haddad-gpu-vulkan", "status": "FAIL", "error": str(e)}, 1)
