using E_RaportoBackend.Data;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Controllers;

/// <summary>
/// Public reference data. Both clients bootstrap from here rather than hardcoding Elbasan's taxonomy —
/// which is what makes onboarding a second municipality a data change, not a release.
/// </summary>
[ApiController]
[Route("api/v1")]
[Tags("Reference data")]
public class ReferenceController(AppDbContext db) : ControllerBase
{
    /// <summary>The issue taxonomy, with colours and icons shared by the map, chips and charts.</summary>
    [HttpGet("categories")]
    [ProducesResponseType<List<CategoryDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CategoryDto>>> GetCategories(CancellationToken ct)
    {
        var categories = await db.Categories
            .AsNoTracking()
            .Include(c => c.DefaultDepartment)
            .OrderBy(c => c.SortOrder)
            .ToListAsync(ct);

        return Ok(categories.Select(c => c.ToDto()).ToList());
    }

    /// <summary>Municipal directorates that reports get routed to, with their SLA targets.</summary>
    [HttpGet("departments")]
    [ProducesResponseType<List<DepartmentDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<List<DepartmentDto>>> GetDepartments(CancellationToken ct)
    {
        var departments = await db.Departments
            .AsNoTracking()
            .Where(d => d.IsActive)
            .OrderBy(d => d.ShortName)
            .ToListAsync(ct);

        return Ok(departments.Select(d => d.ToDto()).ToList());
    }

    /// <summary>Map centre and default radius, so clients aren't hardcoded to Elbasan's coordinates.</summary>
    [HttpGet("municipality")]
    [ProducesResponseType<MunicipalityDto>(StatusCodes.Status200OK)]
    public async Task<ActionResult<MunicipalityDto>> GetMunicipality(CancellationToken ct)
    {
        var municipality = await db.Municipalities.AsNoTracking().OrderBy(m => m.Id).FirstAsync(ct);
        return Ok(municipality.ToDto());
    }
}
