using System.Text.Json.Serialization;

namespace SystemMonitor.Api.Services;

/// <summary>One reading of one sensor. <c>Kind</c> is temperature, voltage or fan; Unit is °C, V or RPM.</summary>
public sealed record HwSensor(
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("value")] double? Value,
    [property: JsonPropertyName("unit")] string Unit,
    [property: JsonPropertyName("highC")] double? HighC,
    [property: JsonPropertyName("criticalC")] double? CriticalC);

/// <summary>A drive, a motherboard sensor chip or a memory module, with the sensors it reports.</summary>
public sealed record HwDevice(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("detail")] string? Detail,
    [property: JsonPropertyName("sensors")] List<HwSensor> Sensors);

/// <summary>The devices of one kind, and when there are none, the reason (never a made-up reading).</summary>
public sealed record HwCategory(
    [property: JsonPropertyName("devices")] List<HwDevice> Devices,
    [property: JsonPropertyName("note")] string? Note);

public sealed record HardwareSensors(
    [property: JsonPropertyName("ready")] bool Ready,
    [property: JsonPropertyName("platform")] string Platform,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("sampledAtMs")] long SampledAtMs,
    [property: JsonPropertyName("drives")] HwCategory Drives,
    [property: JsonPropertyName("board")] HwCategory Board,
    [property: JsonPropertyName("memory")] HwCategory Memory);

/// <summary>A source of drive, motherboard and memory-module sensors that is not sysfs (Windows). Read never blocks and never throws.</summary>
public interface IHardwareSensorSource
{
    HardwareSensors? Read();
}

/// <summary>A sensor as a hardware library reports it, before the rules in <see cref="HardwareSensorSelection"/> are applied.</summary>
public sealed record RawHwSensor(string Type, string Name, double? Value);
