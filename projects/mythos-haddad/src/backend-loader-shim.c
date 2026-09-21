/* MYTHOS HADDAD — ggml multi-backend loader shim.
 *
 * NOT a rebuild of llama.cpp or ggml — those stay the unmodified distro
 * .deb binaries. This is a ~15-line glue library that exists only because
 * of a real, verified constraint (see docs/AI_RUNTIME.md, "Why this shim
 * exists"): ggml's own backend-plugin scan is a hardcoded absolute path
 * baked in at Debian package-build time (/usr/lib/x86_64-linux-gnu/ggml/
 * backends0), which this unprivileged install has no write access to
 * (verified: root:root 0755, confirmed via `touch` and `strace`), and its
 * one override mechanism (GGML_BACKEND_PATH) loads exactly one file per
 * process — not enough for CPU + Vulkan together.
 *
 * This constructor calls the SAME public ggml_backend_load() entry point
 * ggml's own scanner would have called for each file, once per path named
 * in MYTHOS_EXTRA_GGML_BACKENDS (colon-separated), so both backends land
 * in the identical process-wide registry ggml itself maintains. No ggml
 * headers were available (only the runtime .so, no -dev package), so the
 * one function used is forward-declared here from ggml's public API
 * (ggml-backend.h: `ggml_backend_reg_t ggml_backend_load(const char *)`)
 * rather than included.
 *
 * Build:  gcc -shared -fPIC -o libhaddad-backend-loader.so \
 *           backend-loader-shim.c -L<prefix>/usr/lib/x86_64-linux-gnu \
 *           -Wl,-rpath,<prefix>/usr/lib/x86_64-linux-gnu -lggml
 * Rollback: delete the .so — nothing else references it.
 */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

typedef struct ggml_backend_reg *ggml_backend_reg_t;
extern ggml_backend_reg_t ggml_backend_load(const char *path);

__attribute__((constructor))
static void mythos_haddad_load_extra_backends(void) {
    const char *list = getenv("MYTHOS_EXTRA_GGML_BACKENDS");
    if (!list || !*list) return;
    char *copy = strdup(list);
    if (!copy) return;
    for (char *tok = strtok(copy, ":"); tok; tok = strtok(NULL, ":")) {
        ggml_backend_reg_t r = ggml_backend_load(tok);
        if (!r) fprintf(stderr, "[haddad-backend-loader] failed to load %s\n", tok);
    }
    free(copy);
}
