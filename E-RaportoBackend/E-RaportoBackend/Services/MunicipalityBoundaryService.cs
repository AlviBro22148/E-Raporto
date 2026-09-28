using E_RaportoBackend.Data;

namespace E_RaportoBackend.Services;

/// <summary>
/// Point-in-polygon check against Bashkia Elbasan's real administrative boundary — not a radius. The
/// municipality's shape is large and irregular (a dozen rural former communes merged into it in 2015),
/// and the surrounding towns (Gramsh, Librazhd, Belsh, Cërrik, Peqin, Prrenjas) are each their own
/// separate municipality, not part of it — a circle centered on the city would either cut off legitimate
/// outlying villages or bleed into a neighbouring municipality's territory depending on how it's sized.
///
/// Two independent honest-signal checks reuse this, and they answer different questions:
///  · the reporter's live GPS fix — proves they are physically inside the municipality right now;
///  · the report's own pin — proves the problem being reported is inside the municipality's jurisdiction.
/// Neither implies the other: a citizen can find a problem, rush off, and submit later from anywhere
/// else inside Elbasan, moving the pin back to the original spot freely.
/// </summary>
public static class MunicipalityBoundaryService
{
    public static bool IsInsideElbasan(double lat, double lng)
    {
        var polygon = ElbasanBoundary.Polygon;
        var inside = false;
        for (int i = 0, j = polygon.Length - 1; i < polygon.Length; j = i++)
        {
            var (latI, lngI) = polygon[i];
            var (latJ, lngJ) = polygon[j];
            if (lngI > lng != lngJ > lng &&
                lat < (latJ - latI) * (lng - lngI) / (lngJ - lngI) + latI)
            {
                inside = !inside;
            }
        }
        return inside;
    }
}
