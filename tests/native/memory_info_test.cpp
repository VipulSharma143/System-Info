#include "../../native/include/native_engine.h"
#include <cstdio>

int main() {
    long long t, a, f, c, b, st, su, cl, cu;
    if (!si_get_memory_info(&t, &a, &f, &c, &b, &st, &su, &cl, &cu)) {
        std::puts("si_get_memory_info FAILED");
        return 1;
    }
    std::printf("total=%lld avail=%lld free=%lld cached=%lld buffers=%lld swap=%lld/%lld commit=%lld/%lld\n",
                t, a, f, c, b, su, st, cu, cl);
    return (t > 0 && a >= 0 && a <= t) ? 0 : 1;
}