/** GET /api/native/engine: what the native engine (C++ dispatcher over the Assembly kernels) is doing. */
export interface EngineSection {
  name: string;
  kernels: string;
  usedBy: string;
}

export interface EngineStatus {
  /** False when the native library could not be loaded; everything then runs in plain C#. */
  available: boolean;
  /** "AVX2", "SSE2" or "Portable C++" (assembly unavailable, disabled or demoted). */
  isa: string;
  assembly: boolean;
  /** Assembly tiers the startup self-test rejected; 0 on a healthy machine. */
  demotedTiers: number;
  series: {
    active: boolean;
    nativeCalls: number;
    managedCalls: number;
    /** Series shorter than this are cheaper to handle in C# than to hand to the engine. */
    minLength: number;
  };
  sections: EngineSection[];
}
