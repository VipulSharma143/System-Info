namespace SystemMonitor.Api.Services;

// Resolves where local historical data lives. Replaces MongoDB Atlas as the
// persistence layer — see LocalJsonSnapshotStore. Deterministic, writable,
// local, and independent of any database or internet connection.
public static class AppDataPath
{
    // Resolution order:
    //   1. SYSTEM_INFO_DATA_DIR env var — explicit override, works anywhere.
    //   2. Development environment (ASPNETCORE_ENVIRONMENT/DOTNET_ENVIRONMENT)
    //      — ./data next to the working directory, easy to inspect while coding.
    //   3. Platform default — %LOCALAPPDATA%\SystemInfo\data on Windows,
    //      ~/.local/share/SystemInfo/data on Linux. An installed app under
    //      Program Files is normally not writable by a standard user, so the
    //      data directory must never be "beside the executable".
    public static string Resolve()
    {
        var overridden = Environment.GetEnvironmentVariable("SYSTEM_INFO_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(overridden))
        {
            return overridden;
        }

        var env = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
                  ?? Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT");
        if (string.Equals(env, "Development", StringComparison.OrdinalIgnoreCase))
        {
            return Path.Combine(Directory.GetCurrentDirectory(), "data");
        }

        if (OperatingSystem.IsWindows())
        {
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(localAppData, "SystemInfo", "data");
        }

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return Path.Combine(home, ".local", "share", "SystemInfo", "data");
    }

    // Called once at startup. Must never throw for the "directory already
    // exists" case, and should surface a clear error (not a silent crash
    // later on first write) if the resolved location truly isn't writable.
    public static string ResolveAndEnsureCreated()
    {
        var path = Resolve();
        Directory.CreateDirectory(path);

        var probe = Path.Combine(path, ".write-test");
        try
        {
            File.WriteAllText(probe, "");
            File.Delete(probe);
        }
        catch (Exception ex)
        {
            throw new IOException(
                $"Data directory '{path}' is not writable. Set SYSTEM_INFO_DATA_DIR to a writable location.", ex);
        }

        return path;
    }
}
