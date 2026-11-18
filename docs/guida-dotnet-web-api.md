# Guida introduttiva a .NET Web API — attraverso il progetto PostIt

Una guida pensata per uno sviluppatore che **conosce già il C# base** (variabili, classi, interfacce, async/await) ma **non conosce ASP.NET Core / .NET Web API**. L'obiettivo non è la teoria fine a se stessa: ogni concetto viene spiegato agganciandolo a un **file reale di questo progetto**, così impari a leggere e navigare un backend .NET vero.

> **Convenzioni usate in questa guida**
>
> - Tutti i percorsi file sono relativi a `apps/server/` (es. `src/PostIt.Api/Program.cs`).
> - I riferimenti `file:riga` indicano il punto esatto nel codice.
> - I blocchi `> 🧪 ESERCIZIO` contengono attività pratiche. Le soluzioni (o i suggerimenti) sono in Appendice D.
> - Parole tecniche inglesi vengono mantenute volutamente (sono quelle usate in produzione: *request, response, middleware, endpoint...*) e spiegate al primo utilizzo.

---

## Indice

1. [La mappa del territorio](#1-la-mappa-del-territorio)
2. [Il viaggio di una richiesta](#2-il-viaggio-di-una-richiesta)
3. [I Controller e le action](#3-i-controller-e-le-action)
4. [Dependency Injection](#4-dependency-injection)
5. [Program.cs: costruire il web server](#5-programcs-costruire-il-web-server)
6. [Clean Architecture in pratica](#6-clean-architecture-in-pratica)
7. [EF Core + PostgreSQL](#7-ef-core--postgresql)
8. [Autenticazione con JWT](#8-autenticazione-con-jwt)
9. [DTO e mapping](#9-dto-e-mapping)
10. [Real-time con SignalR](#10-real-time-con-signalr)
11. [Middleware custom](#11-middleware-custom)
12. [Errori e pattern di questo progetto](#12-errori-e-pattern-di-questo-progetto)
13. [Testing](#13-testing)
14. [Configurazione, sicurezza e osservabilità](#14-configurazione-sicurezza-e-osservabilità)
- [Appendice A: Glossario](#appendice-a-glossario)
- [Appendice B: Mappa completa dei file](#appendice-b-mappa-completa-dei-file)
- [Appendice C: Ordine di lettura consigliato](#appendice-c-ordine-di-lettura-consigliato)
- [Appendice D: Esercizi — suggerimenti](#appendice-d-esercizi--suggerimenti)

---

## 1. La mappa del territorio

### 1.1 Cosa è PostIt

PostIt (la cartella `apps/server`) è il **backend di un'applicazione di note collaborative a muro** ("pinboard"). In pratica:

- esistono **utenti** (`User`), che si registrano, fanno login e ricevono token;
- gli utenti creano **board** (lavagne) e possono invitare altri utenti come membri;
- ogni board ha **note** (i "post-it") con testo, colore e posizione nella schermata;
- le modifiche alle note vengono trasmesse in **tempo reale** agli altri membri tramite SignalR;
- solo chi ha il permesso giusto (Owner/Editor/Viewer) può leggere o modificare.

Questo è il file `PLAN.BE.md` alla radice del repo: è il **piano tecnico** da cui il backend è nato. Vale la pena leggerlo perché spiega *perché* ogni pezzo esiste.

### 1.2 Cosa è un'API web (in 30 secondi)

.NET Web API è un framework per costruire **server HTTP**: programmi che ascoltano richieste come `POST /api/auth/login`, elaborano dati e rispondono. Il client (browser, frontend React, Postman, test automatici) invia una **richiesta HTTP** e riceve una **risposta HTTP** (generalmente JSON).

La differenza chiave rispetto a un'app console o una libreria: **il programma non "gira" da solo** — resta in ascolto e ogni richiesta arrivata diventa un lavoro da completare. Questo è il modello mentale da tenere sempre.

### 1.3 La soluzione: i progetti e le dipendenze

Un progetto .NET compila in un'assemblea (DLL). Una *solution* (`.sln`) raggruppa più progetti collegati tra loro da *ProjectReference*. Qui la solution è `PostIt.sln`.

La struttura (vedi anche `PLAN.BE.md`):

```
apps/server/
├── PostIt.sln
├── src/
│   ├── PostIt.Api/            → l'applicazione web vera e propria
│   ├── PostIt.Application/    → logica applicativa (casi d'uso)
│   ├── PostIt.Domain/         → entità e regole di dominio
│   └── PostIt.Infrastructure/ → database, autenticazione, repository
└── tests/
    ├── PostIt.UnitTests/        → test unitari (xUnit + Moq)
    └── PostIt.IntegrationTests/ → test di integrazione (WebApplicationFactory)
```

Guarda le reference dichiarate nei `.csproj`:

| Progetto | Riferimenti |
|---|---|
| `PostIt.Domain` (`src/PostIt.Domain/PostIt.Domain.csproj`) | nessuno — è la base |
| `PostIt.Application` | `PostIt.Domain` |
| `PostIt.Infrastructure` | `PostIt.Application`, `PostIt.Domain` |
| `PostIt.Api` (`src/PostIt.Api/PostIt.Api.csproj:23-24`) | `PostIt.Application`, `PostIt.Infrastructure` |

Da queste reference si vede la **direzione della dipendenza**: ogni livello può usare solo i livelli "sotto" di sé.

### 1.4 Clean Architecture: la regola delle dipendenze

Questo progetto segue la **Clean Architecture** (architettura pulita). Il principio fondamentale è la *Dependency Rule*: le dipendenze puntano **verso l'interno**, mai verso l'esterno.

```
           ┌─────────────────────────────┐
           │  PostIt.Api (HTTP, web)     │  "fuori": come gli altri parlano con noi
           └──────────────┬──────────────┘
                          │ usa
           ┌──────────────▼──────────────┐
           │  PostIt.Application         │  logica dei casi d'uso
           │  (servizi + interfacce)     │
           └──────────────┬──────────────┘
                          │ usa
              ┌───────────▼───────────┐
              │  PostIt.Domain        │  entità e regole, senza ASP.NET
              └───────────────────────┘

PostIt.Infrastructure (EF Core, Npgsql, JWT)
        └─ implementa le interfacce definite in Application
```

Conseguenze pratiche che vedrai nel codice:

- **PostIt.Domain** contiene solo entità (`src/PostIt.Domain/Entities/*.cs`) e l'enum dei ruoli (`src/PostIt.Domain/Enums/BoardRole.cs`). **Non importa nulla di ASP.NET** — nessun `HttpContext`, nessun `DbContext` qui dentro.
- **PostIt.Application** definisce i *contratti*: interfacce (`src/PostIt.Application/Interfaces/*.cs`), DTO (`src/PostIt.Application/DTOs/*.cs`) e servizi (`src/PostIt.Application/Services/*.cs`). Qui NON c'è codice di database o HTTP.
- **PostIt.Infrastructure** implementa i contratti: repository con EF Core, hashing password, token JWT (`src/PostIt.Infrastructure/**`).
- **PostIt.Api** è il livello "esterno": controller, middleware, hub SignalR, configurazione DI. Sa tutto, ma non contiene logica di business.

> Un trucco per verificare la regola mentalmente: se in `PostIt.Application` vedi un `using Microsoft.EntityFrameworkCore`, qualcosa è rotto.

### 1.5 La Dependency Inversion (il pezzo finale per capire tutto)

L'unione di dipendenze dal diagramma di 1.3 e la regola di 1.4 dà la **Dependency Inversion** (la "D" di SOLID):

> *PostIt.Application* dichiara `INoteRepository`. Non sa chi lo implementa. *PostIt.Infrastructure* lo implementa con `NoteRepository`. *PostIt.Api* decide quale implementazione usare (nel bundle di DI, vedi cap. 4).

Il risultato: posso cambiare PostgreSQL con SQL Server, o con un mock nei test, **senza toccare i servizi**. È esattamente ciò che fanno i test unitari del cap. 13.

---

## 2. Il viaggio di una richiesta

Niente spiega un framework web meglio che seguire una singola richiesta dal primo byte al database e ritorno. Seguiamo `POST /api/auth/register`, chiamato dalla riga 24 di `tests/PostIt.IntegrationTests/AuthEndpointsTests.cs:24` (in realtà dal test, ma è identico a una chiamata di Postman).

### 2.1 La richiesta parte

Un client invia:

```
POST /api/auth/register HTTP/1.1
Content-Type: application/json

{ "email": "mario@example.com", "password": "Segreta123!", "displayName": "Mario" }
```

Il sistema operativo accetta la connessione sulla **porta di ascolto**. Chi l'ha aperta? `Program.cs`.

### 2.2 Tappa 1 — il Server e il Middleware

`src/PostIt.Api/Program.cs:17` costruisce l'app: `var builder = WebApplication.CreateBuilder(args);`. `Program.cs:151` la materializza: `var app = builder.Build();`.

Subito dopo, il programma compone una **pipeline** (cap. 5 e 11): un elenco in ordine di "tappi" che ogni richiesta attraversa. Per questa richiesta attraversa (tra gli altri):

- il middleware di logging HTTP (`Program.cs:64`),
- il middleware di autenticazione (`Program.cs:169`),
- il rate limiter (`Program.cs:174`), 
- l'`ExceptionHandlingMiddleware` (`Program.cs:159`).

Poi `Program.cs:196` (`app.MapControllers()`) la instrada verso il controller giusto. .NET ha già "matchato" l'URL: `/api/auth` → `AuthController` (attributo `[Route("api/auth")]`), il verbo `POST` + il frammento `register` → metodo `Register` (attributo `[HttpPost("register")]`).

### 2.3 Tappa 2 — il Controller

Entriamo in `AuthController.Register` — `src/PostIt.Api/Controllers/AuthController.cs:25`:

```csharp
public async Task<ActionResult<LoginResponse>> Register(RegisterRequest request, CancellationToken cancellationToken)
{
    try
    {
        var response = await _authService.RegisterAsync(request, cancellationToken);
        return Ok(response);
    }
    catch (InvalidOperationException ex)
    {
        return Problem(ex.Message, statusCode: StatusCodes.Status400BadRequest);
    }
}
```

Cosa succede qui:

1. **Model binding** (cap. 3.3): il framework legge il JSON dal corpo della richiesta e crea l'oggetto `RegisterRequest`. Se il JSON non combacia, risponde da solo con `400`.
2. Il controller è **magro**: non scrive SQL, non salva nulla. Delega a `_authService` (iniettato, vedi cap. 4).
3. In caso di errore "previsto" cattura l'eccezione e risponde con `Problem()` → un **Problem Details** JSON (cap. 12).
4. In caso di successo risponde `Ok(response)` → HTTP `200` + JSON.

Il controller non sa *come* si registra un utente. Sa *quando* qualcosa non va e come tradurlo in uno status code.

### 2.4 Tappa 3 — il Service

`AuthService.RegisterAsync` — `src/PostIt.Application/Services/AuthService.cs:26`:

```csharp
if (await _userRepository.EmailExistsAsync(request.Email, cancellationToken))
    throw new InvalidOperationException("User with this email already exists.");

var user = new User(request.Email, string.Empty, request.DisplayName);
var passwordHash = _passwordHasher.HashPassword(user, request.Password);
user = new User(request.Email, passwordHash, request.DisplayName);

await _userRepository.AddAsync(user, cancellationToken);

var accessToken   = _tokenService.GenerateAccessToken(user);
var refreshTokenValue = _tokenService.GenerateRefreshToken();
var refreshToken  = new RefreshToken(refreshTokenValue, user.Id, DateTime.UtcNow.AddDays(7));

await _refreshTokenRepository.AddAsync(refreshToken, cancellationToken);

return new LoginResponse(accessToken, refreshTokenValue, DateTime.UtcNow.AddMinutes(15));
```

Qui c'è **la logica**: regola di unicità, hashing della password, creazione entità, generazione token. Il service coordina altre astrazioni (repository, hasher, token service) **senza sapere** quale database o quale libreria stia dietro. Ha solo le interfacce (cap. 6.3).

Nota le eccezioni: `InvalidOperationException` viene lanciata quando l'email esiste già. Sarà il controller (non il service) a decidere che ciò significa `400 Bad Request`.

### 2.5 Tappa 4 — il Repository

`UserRepository.AddAsync` — `src/PostIt.Infrastructure/Persistence/Repositories/UserRepository.cs` (insieme a `NoteRepository.cs`, che val la pena aprire): 

```csharp
public async Task AddAsync(Note note, CancellationToken cancellationToken = default)
{
    await _context.Notes.AddAsync(note, cancellationToken);   // NoteRepository.cs:33
}
```

Il repository è una singola riga che dice al `DbContext` "traccia questo oggetto". **Ancora nessuna riga scritta su disco.** La modifica resta nella memoria del `DbContext`.

### 2.6 Tappa 5 — EF Core scrive sul database

Il `DbContext` (`PostItDbContext`, cap. 7) è il "unit of work": tiene traccia di tutti i cambiamenti. In questo progetto convivono **due pattern** per il commit:

1. **Il repository salva da sé**: `UserRepository.AddAsync` chiama `SaveChangesAsync()` al suo interno (`src/PostIt.Infrastructure/Persistence/Repositories/UserRepository.cs:31-35`), e idem `RefreshTokenRepository.AddAsync` (`RefreshTokenRepository.cs:24-28`). Il registro quindi scrive in due step.
2. **Il service salva una sola volta**: per le operazioni che toccano più dati in una volta sola (es. "crea board e membro insieme", cap. 7.6), `AddAsync` si limita a tracciare (`NoteRepository.cs:33`) e il **service** chiama `SaveChangesAsync` una volta alla fine, in un'unica transazione (es. `src/PostIt.Application/Services/NoteService.cs:61`).

In entrambi i casi, il dato diventa persistente solo quando il `DbContext` esegue la scrittura sul database.

### 2.7 La risposta torna indietro

L'oggetto `LoginResponse` (access token + refresh token + scadenza) risale la catena: service → controller → `Ok(response)` → .NET lo serializza in JSON → il middleware completa la pipeline → il client lo riceve.

> **La forma più importante del viaggio**: `Controller → Service → Repository → DbContext → DB` e ritorno. Ogni concetto delle prossime sezioni si incastra in questa freccia.
>
> 🧪 **ESERCIZIO 1** — Metti un breakpoint in `AuthController.cs:29` (il `await _authService.RegisterAsync(...)`), avvia l'app e chiama `POST /api/auth/register` da Swagger (il progetto lo ha configurato, vedi cap. 5). Usa la finestra *Call Stack* per vedere che è stato il framework a chiamare il controller. Poi osserva: in quale altro metodo il codice si ferma?

---

## 3. I Controller e le action

### 3.1 Cosa è un controller

Un **controller** è una classe C# che ASP.NET istanzia per gestire le richieste relative a una certa risorsa. Ogni metodo pubblico (chiamato *action*) corrisponde a un endpoint. Qui ne hai tre: `AuthController`, `BoardsController`, `NotesController`.

Due attributi per classe (`src/PostIt.Api/Controllers/NotesController.cs:9-11`):

```csharp
[ApiController]
[Route("api")]
[Authorize]
public class NotesController : ControllerBase
```

- `[ApiController]` (riga 9): abilita i comportamenti automatici di Web API — il più utile è la **validazione automatica**: se il `model binding` fallisce o le proprietà violate le `[Required]`/`[Range]`, .NET risponde con `400` senza che tu scriva codice.
- `[Route("api")]` (riga 10): prefisso URL per tutti gli endpoint della classe. `BoardsController` usa `[Route("api/boards")]`.
- `[Authorize]` (riga 11): richiede un utente autenticato per **tutti** gli endpoint della classe. Vedi cap. 8.

La classe eredita da `ControllerBase`, che fornisce helper utili (`Ok`, `Problem`, `NoContent`, `User`, ...).

### 3.2 Gli attributi delle action

Ogni action ha un attributo di **verbo HTTP** e la parte di route che la distingue:

```csharp
[HttpGet("boards/{boardId:guid}/notes")]                      // NotesController.cs:21
public async Task<ActionResult<IReadOnlyList<NoteDto>>> GetNotes(Guid boardId, ...)

[HttpPost("boards/{boardId:guid}/notes")]                     // NotesController.cs:49
public async Task<ActionResult<NoteDto>> CreateNote(Guid boardId, CreateNoteRequest request, ...)

[HttpPut("notes/{noteId:guid}")]                              // NotesController.cs:82
public async Task<ActionResult<NoteDto>> UpdateNote(Guid noteId, UpdateNoteRequest request, ...)

[HttpDelete("notes/{noteId:guid}")]                           // NotesController.cs:115
public async Task<IActionResult> DeleteNote(Guid noteId, ...)
```

I concetti:

- **Verbi HTTP**: `GET`=leggi, `POST`=crea, `PUT`=aggiorna, `DELETE`=elimina. Questa convenzione si chiama *REST*.
- **Route di segmento**: `{boardId:guid}` è un segnaposto. `:guid` è un **vincolo**: se nel URL c'è `/boards/abc/notes` (non un GUID valido), la route non combacia e .NET risponde `404`/`400` automaticamente.
- **URL risultante**: `[Route("api")]` + `[HttpGet("boards/{boardId:guid}/notes")]` → `GET /api/boards/{boardId}/notes`.
- **`[ProducesResponseType]`**: pura documentazione per Swagger. Dice "questo endpoint può rispondere 200 con un `NoteDto`, 404 con un `ProblemDetails`, etc." Non cambia il comportamento: è un contratto leggibile da strumenti e frontend.
- **`CancellationToken cancellationToken`**: .NET può iniettarlo automaticamente. Nella maggior parte dei casi il framework lo cancella se il client interrompe la connessione o scade il timeout; le chiamate `async/await` con il token possono quindi **fermarsi prima** degli accessi al database, risparmiando lavoro.

### 3.3 Model binding: come arrivano i dati

I parametri di un'action vengono "riempiti" automaticamente dal framework:

- **Dal corpo JSON** → per i tipi custom (es. `RegisterRequest`, `CreateNoteRequest`). È il *body binding*, richiede `[ApiController]`.
- **Dalla URL** → parametri semplici con lo stesso nome del segmento di route (`Guid boardId`).
- **Dal query string** → parametri semplici opzionali (`?page=2`).
- **Dall'header o dal form** → con attributi espliciti (`[FromHeader]`, `[FromForm]`).

### 3.4 ActionResult e i metodi helper

Il tipo di ritorno `ActionResult<T>` dice al framework: *"la risposta può essere sia dati T sia un risultato HTTP"*. I metodi di `ControllerBase` che vedi ovunque:

| Helper | Risposta HTTP | Uso |
|---|---|---|
| `return Ok(obj)` | `200` | successo con dati |
| `return NoContent()` | `204` | successo senza dati (DELETE) |
| `return Problem(msg, statusCode: 400)` | status scelto | errore, in formato Problem Details |
| `return NotFound()/Unauthorized()` | `404`/`401` | varianti preimpostate |

`Problem()` è la modalità "seria": ritorna un oggetto standard `application/problem+json` con `title`, `status`, `detail`... come prescrive `PLAN.BE.md` §14.

> **Perché 401 vs 403 è importante**: 401 = "non sei autenticato" (manca/è invalido il token). 403 = "sei autenticato ma non hai i permessi" (es. un Viewer che tenta di modificare). Entrambi sono gestiti in questo progetto: `[Authorize]` produce automaticamente il 401; i service lanciano `UnauthorizedAccessException` che i controller traducono in 403 (es. `NotesController.cs:43-46`).

### 3.5 `[Authorize]` e il contesto `User`

Dentro una action protetta da `[Authorize]`, il framework mette a disposizione la proprietà `User` (di tipo `ClaimsPrincipal`): i dati estratti dal token JWT. Per recuperare l'id dell'utente loggato il progetto usa sempre lo stesso helper (es. `NotesController.cs:143-154`):

```csharp
private Guid? GetCurrentUserId()
{
    var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)
        ?? User.FindFirst("sub");
    if (userIdClaim == null || !Guid.TryParse(userIdClaim.Value, out var userId))
        return null;
    return userId;
}
```

`User.FindFirst(...)` cerca una **claim** (un "dato firmato" dentro il token). Il claim `sub` contiene l'id utente come stringa, quindi viene convertito in `Guid`. Se non c'è, ritorna `null` e la action risponde `401` (es. `NotesController.cs:29-32`).

### 3.6 Walkthrough comparativo dei tre controller

Aprendo i tre controller noterai un **pattern ripetuto**, ed è una virtù:

```csharp
var userId = GetCurrentUserId();
if (userId == null)
    return Problem(statusCode: StatusCodes.Status401Unauthorized);

try
{
    var result = await _service.SomeOperationAsync(userId.Value, ...);
    return Ok(result);
}
catch (KeyNotFoundException)     { return Problem(statusCode: 404); }
catch (UnauthorizedAccessException) { return Problem(statusCode: 403); }
catch (ArgumentException ex)     { return Problem(ex.Message, statusCode: 400); }
```

| Eccezione lanciata dal service | Status del controller | Significato |
|---|---|---|
| `KeyNotFoundException` | `404` | risorsa inesistente |
| `UnauthorizedAccessException` | `403` | autenticato ma senza permesso |
| `ArgumentException` / `InvalidOperationException` | `400`/`409` | input non valido / conflitto |

Questa *mappa* ricorre identica in tutto il progetto. È il modo più semplice di gestire gli errori in un'app a strati, e il cap. 12 la approfondisce.

> Nota in `BoardsController.cs:178-214` il caso d'uso dell'`InvalidOperationException` → `409 Conflict` (duplicato membro). Ogni controller declina la mappa a seconda della propria casistica.

---

## 4. Dependency Injection

### 4.1 Il problema che risolve

`AuthService` ha bisogno di un repository, di un password hasher e di un token service. Senza DI, dovrei scrivere:

```csharp
var authService = new AuthService(new UserRepository(new PostItDbContext()), ...);
```

Questo annida le dipendenze e rende impossibile sostituirle nei test. La **Dependency Injection** (DI) inverte la responsabilità: un **contenitore centrale** costruisce gli oggetti e fornisce loro le dipendenze automaticamente.

### 4.2 Il contenitore: `IServiceCollection`

`Program.cs:17-20`:

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
```

`builder.Services` è il contenitore: una "scatola" in cui si registrano i **servizi**. La registrazione è sempre della forma: *"quando qualcuno chiede l'interfaccia X, dagli l'implementazione Y"*.

### 4.3 Le extension methods dei layer

Per tenere il contenitore pulito, ogni layer espone una **extension method**. `src/PostIt.Application/DependencyInjection.cs:8-16`:

```csharp
public static IServiceCollection AddApplication(this IServiceCollection services)
{
    services.AddScoped<IAuthService, AuthService>();
    services.AddScoped<IBoardService, BoardService>();
    services.AddScoped<IBoardMemberService, BoardMemberService>();
    services.AddScoped<IBoardAuthorizationService, BoardAuthorizationService>();
    services.AddScoped<INoteService, NoteService>();
    return services;
}
```

`src/PostIt.Infrastructure/DependencyInjection.cs:13-36` fa lo stesso per `AddDbContext`, repository, `IPasswordHasher`→`PasswordHasher`, `ITokenService`→`JwtTokenService`.

L'importante: **i servizi dipendono dalle interfacce**, che sono candidate al contenitore; il layer che *decide* è Api, che chiama entrambe le extension. Questo è il punto di "composizione" del cap. 1.5.

### 4.4 I lifetime: Scoped, Transient, Singleton

I tre tempi di vita di un servizio registrato:

| Lifetime | Quando viene creato | Esempio nel progetto |
|---|---|---|
| `AddScoped<T>()` | una nuova istanza per **ogni richiesta** HTTP | servizi, repository, `DbContext` — vedi `DependencyInjection.cs:10` |
| `AddTransient<T>()` | ogni volta che viene richiesto | servizi leggeri senza stato |
| `AddSingleton<T>()` | una sola istanza per **tutta la vita** del processo | cache, configurazione |

Regola d'oro: **il `DbContext` deve essere Scoped** — così ogni richiesta ha un "in-memory unit of work" isolato che verrà eliminato a fine richiesta. Se due richieste condividessero lo stesso `DbContext`, i cambiamenti dell'una interferirebbero con l'altra.

### 4.5 L'iniezione via costruttore

Il pattern dominante in questo progetto — `AuthService.cs:14-24`:

```csharp
public AuthService(
    IUserRepository userRepository,
    IRefreshTokenRepository refreshTokenRepository,
    IPasswordHasher passwordHasher,
    ITokenService tokenService)
{
    _userRepository = userRepository;
    _refreshTokenRepository = refreshTokenRepository;
    _passwordHasher = passwordHasher;
    _tokenService = tokenService;
}
```

Il contenitore, quando deve costruire `AuthService` (perché muta la richiesta a un endpoint di `AuthController` che ne dipende), guarda il **costruttore**, risolve ogni interfaccia con la sua registrazione e costruisce l'oggetto. Nessun `new`.

> 🧪 **ESERCIZIO 2** — Apri `NoteService` (ha 4 dipendenze nel costruttore). Accedi a Swagger ed esegui una creazione note. Metti un breakpoint *dentro* il costruttore di `NoteRepository` (`src/PostIt.Infrastructure/Persistence/Repositories/NoteRepository.cs:11`): verrai fermato con l'intero `NoteService` che ti attende. Chi ha chiamato il costruttore? Guarda in *Call Stack*: trovi un `ActivatorUtilities`/DI interno; è il contenitore.

---

## 5. Program.cs: costruire il web server

`Program.cs` intero non è "magia" ma due fasi chiare.

### 5.1 Fase di configurazione (righe 17-149): "cosa costruire"

Si usa `builder` per registrare **servizi** (la colonna "add") e **configurazione**:

- `AddControllers()` (riga 22) — registra il framework MVC e tutti i controller;
- `AddSwaggerGen` (riga 24) — documentazione interattiva `/swagger`, con definizione dello schema di sicurezza Bearer (righe 33-55) così dagli endpoint puoi incollare il token;
- logging (righe 59-62) ed `AddHttpLogging` (riga 64);
- autenticazione JWT (righe 71-110) — cap. 8;
- `AddAuthorization()` (riga 112);
- `AddSignalR()` (riga 115) e `AddScoped<IBoardNotificationService, BoardNotificationService>()` (riga 116);
- rate limiting (righe 119-132): utile per gli endpoint auth, max 5 richieste/minuto per IP;
- health check con verifica del database (righe 134-138);
- CORS (righe 140-149): cosa/chi è autorizzato a chiamarci dal browser.

### 5.2 Fase di avvio (righe 151-203): "come si comporta" — il middleware pipeline

`builder.Build()` crea l'app. Poi si **compone il middleware**: un elenco ordinato di delegati che ogni richiesta attraversa in ordine, come i tubi di un acquedotto. Ogni middleware può: elaborare, passare al successivo (`await _next(...)`), o rispondere e **interrompere** la catena.

Ordine effettivo nel progetto (righe 153-201):

```
Swagger UI (dev)          riga 153-157
ExceptionHandlingMiddleware   riga 159   → primo! cattura errori di tutti quelli dopo
HttpLogging (dev)         riga 161-164
UseHttpsRedirection       riga 166
UseCors                   riga 167
UseAuthentication         riga 169   → legge il JWT e popola User
UseAuthorization          riga 170   → applica [Authorize]
UseRateLimiter            riga 172-175
MapHealthChecks           riga 177
MapControllers            riga 196   → instradamento ai controller
MapHub<BoardHub>          riga 197   → SignalR
Minimal API /api/ping     riga 199
```

### 5.3 Perché l'ordine è importante

C'è un motivo se `UseAuthentication` viene **prima** di `UseAuthorization` e di `MapControllers`: ogni middleware lavora sul lavoro del precedente. Se l'autenticazione venisse dopo `MapControllers`, al momento dell'instradamento `User` sarebbe ancora vuoto e `[Authorize]` fallirebbe sempre.

Allo stesso modo, `ExceptionHandlingMiddleware` sta **in cima** perché deve avvolgere tutta la catena: se un middleware più a valle lancia un'eccezione, quella "risale" verso il primo tappo che la gestisce.

> Il modello mentale: ogni richiesta entra dal primo middleware e "scende" fino all'endpoint, poi la risposta "risale" attraversando di nuovo la catena (alcuni middleware, come quello degli errori, lavorano principalmente in uscita).

### 5.4 Minimal API e la differenza con i controller

`Program.cs:199-201` mostra un secondo modo (più compatto) di definire endpoint:

```csharp
app.MapGet("/api/ping", () => Results.Ok(new { message = "pong", timestamp = DateTimeOffset.UtcNow }))
   .WithName("Ping")
   .WithOpenApi();
```

È la **Minimal API**: niente controller, niente `[ApiController]`, solo lambda. Il progetto mainstream usa i controller, ma questo snippet mostra la stessa pipeline. È utile a sbloccare la differenza: i controller servono quando le action crescono e servono attributi/organizzazione.

> 🧪 **ESERCIZIO 3** — Apri Swagger: `https://localhost:PORT/swagger`. Guarda *Authorization* in alto a destra: dopo il login (cap. 8) potrai scrivere `Bearer <token>` e chiamare tutti gli endpoint protetti. Riepilogo del flux da testare: register → login → crea board → crea note → osserva la nota creata rispondere in tempo reale (cap. 10).

---

## 6. Clean Architecture in pratica

Superata la superficie (controller, DI, Program.cs), guardiamo come i fili dell'architettura si vedono nei tipi concreti.

### 6.1 Entità "rich" e `private set`

Le entità di `PostIt.Domain/Entities` sono **rich domain models** (modelli di dominio "ricchi"), non semplici contenitori. Tre tratti caratteristici — es. `Board.cs`:

```csharp
public Guid Id { get; private set; }          // riga 5: nessuno può cambiare l'id
public User Creator { get; private set; } = null!;   // riga 11: navigazione senza init

private Board() { }                           // riga 15: solo per EF Core (materializzazione via reflection)
public Board(string name, Guid createdBy)     // riga 17: costruzione valida
{
    Id = Guid.NewGuid();
    Name = name;
    CreatedBy = createdBy;
    CreatedAt = DateTime.UtcNow;
    UpdatedAt = DateTime.UtcNow;
}

public void UpdateName(string name)           // riga 26: REGOLE di modifica
{
    Name = name;
    UpdatedAt = DateTime.UtcNow;
}
```

Cosa significa:

- Le proprietà hanno `private set`: per costruire un `Board` devi passare dal **costruttore pubblico** (riga 17), quindi non puoi creare una board "rotta".
- I cambi (come `UpdateName`) passano da **metodi di comportamento** che applicano regole e aggiornano lo stato (qui: l'orologio `UpdatedAt`).
- Il **costruttore privato vuoto** esiste **solo** per EF Core, che deve ricreare oggetti da righe di database senza chiamare regole. Il `null!` sulle proprietà di navigazione dice al compilatore "lo so, può essere null finché EF non lo popola" — è il modo per lavorare in *nullable reference types* senza warning.
- `Id = Guid.NewGuid()` all'interno dell'entità: il database non decide l'id; lo genera l'applicazione dimostrando che questi sono **prodotti di dominio**, non "righe di database".

Confronta con `Note.cs`, `User.cs`, `BoardMember.cs`, `RefreshToken.cs`: stesso schema (set privati, costruttori che validano, metodi di comportamento: `Note.UpdateContent` a riga 33, `RefreshToken.Revoke` a riga 25, `BoardMember.UpdateRole` a riga 27).

> Il vantaggio: *la regola vive insieme ai dati*. Se in futuro servirà "non puoi usare una board senza nome", si aggiunge un controllo nel costruttore di `Board` e *ogni* percorso di creazione è automaticamente protetto — controller, servizi, test.

### 6.2 Interfacce in Application, implementazioni in Infrastructure

Apri `src/PostIt.Application/Interfaces/INoteRepository.cs`:

```csharp
public interface INoteRepository
{
    Task<Note?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Note>> GetNotesByBoardAsync(Guid boardId, CancellationToken cancellationToken = default);
    Task AddAsync(Note note, CancellationToken cancellationToken = default);
    Task DeleteAsync(Note note, CancellationToken cancellationToken = default);
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
```

E la relativa implementazione in `src/PostIt.Infrastructure/Persistence/Repositories/NoteRepository.cs`. Chi le "cuce" insieme è il contenitore DI (cap. 4.3).

L'Application **non può** accedere al repository (in quello strato non c'è `PostItDbContext`): può solo chiamarlo via interfaccia. Questa inversione permette le sostituzioni:
- nei **test unitari** viene data una classe finta (*mock*) che fa finta di parlare al database (cap. 13.2);
- in altri ambienti, l'intera infrastruttura di persistenza si può cambiare **senza toccare `AuthService`, `BoardService`, `NoteService`**.

### 6.3 Il pezzo che "cucisce": la composition root

`Program.cs` è la **composition root**: il punto dove l'app assemblea le interfacce con le implementazioni. Non a caso è "unico": lì si registra `AddApplication()` (interfacce dei servizi → implementazioni Application) e `AddInfrastructure()` (interfacce dei repository → implementazioni EF). Il resto del codice non ha "dove" sa chi fa cosa.

### 6.4 Perché "conoscere C#" non basta qui

C# base ti dà: classi, `interface`, LINQ (`=>` nelle lambda), `async/await`, `record`. Quello che la Clean Architecture aggiunge è **dove mettere le cose**. Regola mnemonica per i tuoi prossimi progetti:

```
Domanda                       | Layer
------------------------------|--------------------------
Questo concetto supererebbe  | PostIt.Domain
un cambio di database?       |
È una regola di business?    | PostIt.Domain (entità, enum, valida nel costruttore)
È un caso d'uso orchestrato? | PostIt.Application
Devo parlare col DB, HTTP    | PostIt.Infrastructure
o con la crittografia?       |
Vive di attributi HTTP e     | PostIt.Api
route?                       |
```

---

## 7. EF Core + PostgreSQL

### 7.1 Cos'è EF Core

**Entity Framework Core** è l'ORM (Object-Relational Mapper) di .NET: traduce oggetti C# che scrivi tu in righe di database, e righe di database in oggetti C#. Per usarlo non scrivi SQL — scrivi LINQ ed EF lo converte.

### 7.2 Il `DbContext`

`src/PostIt.Infrastructure/Persistence/PostItDbContext.cs`:

```csharp
public DbSet<User> Users => Set<User>();        // riga 14
public DbSet<Board> Boards => Set<Board>();     // riga 15
public DbSet<BoardMember> BoardMembers => Set<BoardMember>();  // riga 16
public DbSet<Note> Notes => Set<Note>();        // riga 17
public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>(); // riga 18

protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    base.OnModelCreating(modelBuilder);
    modelBuilder.HasDefaultSchema("public");                    // riga 23
    modelBuilder.ApplyConfigurationsFromAssembly(Assembly.GetExecutingAssembly()); // riga 24
}
```

`DbSet<T>` = "tupla di quelle entità": su di esso fai query (`_context.Notes.FirstOrDefaultAsync(...)`). `OnModelCreating` è dove si dice a EF come sono fatte le tabelle; il trucco alla riga 24 le carica **tutte le** classi `IEntityTypeConfiguration` dell'assemblea (vedi sotto), così ogni entità ha la sua configurazione in un file dedicato.

Il `DbContext` è registrato Scoped in `DependencyInjection.cs:17-26` con `UseNpgsql` (driver PostgreSQL) e la connection string presa da configurazione (`GetConnectionString("DefaultConnection")`).

### 7.3 Le configuration Fluent API

In `src/PostIt.Infrastructure/Persistence/Configurations/` c'è un file per entità. Es. `NoteConfiguration.cs`:

```csharp
builder.ToTable("Notes");                                  // riga 11: nome tabella
builder.HasKey(n => n.Id);                                 // riga 13: primary key
builder.Property(n => n.Content)
    .IsRequired()
    .HasMaxLength(2000);                                   // righe 18-20: VARCHAR(2000) NOT NULL
builder.HasIndex(n => n.BoardId);                          // riga 38: indice per le query per board
builder.HasOne(n => n.Board)
    .WithMany(b => b.Notes)                                // righe 40-43: relazione 1-N
    .HasForeignKey(n => n.BoardId)
    .OnDelete(DeleteBehavior.Cascade);
builder.HasOne(n => n.Creator)
    .WithMany()
    .HasForeignKey(n => n.CreatedBy)
    .OnDelete(DeleteBehavior.SetNull);                     // righe 45-48: se l'utente viene eliminato → NULL
```

Le più frequenti:
- `IsRequired()` / `HasMaxLength(n)`: vincoli NOT NULL / lunghezza;
- `HasIndex()`: indici per performance (riga 38);
- `HasOne/WithMany/WithOne` + `HasForeignKey`: le **relazioni** e le chiavi esterne;
- `OnDelete(DeleteBehavior.Cascade | SetNull | Restrict)`: il comportamento quando una riga padre viene cancellata.

Confronta `UserConfiguration.cs` (indice univoco su Email, righe 19-20) e `BoardConfiguration.cs` (relazioni Members e Notes in cascade).

### 7.4 Le migrazioni

Le migrazioni sono **versioni del modello** salvate come codice C# in `src/PostIt.Api/Migrations/` (nota: il progetto Api ospita le migrazioni — impostato via `MigrationsAssembly("PostIt.Api")` in `DependencyInjection.cs:23`). Quando cambi il modello (es. aggiungi una colonna), generi una nuova migrazione che EF confronta con lo schema e produce il `ALTER TABLE`.

Qui trovi 3 migrazioni storiche: `_Initial`, `_AddDatabaseModel`, `_AddRefreshTokens`. File `.Designer.cs` = metadati (EF non tocca). Il file `PostItDbContextModelSnapshot.cs` è lo "stato finale" del modello a cui EF confronta le prossime migrazioni.

I test di integrazione applicano le migrazioni a un database reale (`TestWebApplicationFactory.cs:84`). In sviluppo locale basta `dotnet ef database update` (o `MigrateAsync` all'avvio).

### 7.5 Il pattern Repository

Un **repository** è una facciata sopra le query: espone metodi semantici (`GetNotesByBoardAsync`, `AddAsync`) invece di lasciare LINQ ovunque. `NoteRepository.cs:22-29`:

```csharp
public async Task<IReadOnlyList<Note>> GetNotesByBoardAsync(Guid boardId, CancellationToken cancellationToken = default)
{
    return await _context.Notes
        .AsNoTracking()
        .Where(n => n.BoardId == boardId)
        .OrderBy(n => n.CreatedAt)
        .ToListAsync(cancellationToken);
}
```

Analizza le righe:
- `_context.Notes` → parto dalla "tabella" Note;
- `.Where(n => n.BoardId == boardId)` → tradotto in `WHERE "BoardId" = @p`;
- `.OrderBy(n => n.CreatedAt)` → `ORDER BY`;
- `.ToListAsync(...)` → esegue la query e materializza la lista;
- `.AsNoTracking()` → "non serve che EF tenga traccia di questi oggetti per futuri update": è una lettura pura, evita overhead. Le entità restituite non sono collegate al contesto.

I repository qui sono **sottili** (solo accesso dati): la logica sta nei service. Non tutti i progetti fanno così, ma è una scelta pulita che i test favoriscono.

### 7.6 `SaveChanges` come unit of work

Il pattern *Unit of Work*: tutte le modifiche vengono "registrate" nel contesto e **scritte insieme** in un'unica `INSERT`/`UPDATE`/`DELETE` quando chiami `SaveChangesAsync()`. Se qualcosa fallisce, l'intero batch viene annullato. Vedilo in azione in `BoardService.CreateBoardAsync` (`BoardService.cs:19-30`):

```csharp
var board = new Board(request.Name, userId);
board.Members.Add(new BoardMember(board.Id, userId, BoardRole.Owner)); // riga 24

await _boardRepository.AddAsync(board, cancellationToken);
await _boardRepository.SaveChangesAsync(cancellationToken);
```

Nota: nel `DbContext` c'è traccia sia della board sia del membro; una singola `SaveChangesAsync` crea **entrambi** gli INSERT in transazione. Questo realizza il piano (PLAN.BE.md: "la creazione assegna il creatore come Owner, persistito transazionalmente").

> 🧪 **ESERCIZIO 4** — In `NoteConfiguration.cs` cambia `HasMaxLength(2000)` in `HasMaxLength(100)`; poi avvia l'integrazione test (cap. 13) e osserva un test fallire: ora una nota lunga viene respinta dal database, ma la validazione applicativa (`NoteService.cs:115-126`) permette 1000 caratteri. È la dimostrazione del perché si definiscono i limiti **al livello giusto** (o si allineano i due livelli). Poi ripristina la modifica.

---

## 8. Autenticazione con JWT

### 8.1 Il problema

Un client che chiama `GET /api/boards/{id}` deve dimostrare *chi è*. HTTP di per sé è stateless: non ricorda nulla tra una richiesta e l'altra. Serve un **token**: un documento firmato che il client presenta a ogni richiesta.

### 8.2 Cos'è un JWT

Un **JWT** (JSON Web Token) è una stringa in 3 parti separate da punti:

```
<header>.<payload>.<firma>
```

- **header**: algoritmo usato (`HS256`);
- **payload**: i *claims* (dati), es. `{ "sub": "id-utente", "email": "...", "exp": ... }`;
- **firma**: hash di header+payload calcolato col **segreto** del server.

Il punto cruciale: il token è **firmato** con un segreto che solo il server conosce. Il client può anche aprirlo e leggerlo, ma **non può alterarlo** senza invalidare la firma. Il server non deve conservare stato: basta ricalcolare la firma e confrontarla.

### 8.3 Come il progetto genera il token

`JwtTokenService.GenerateAccessToken` — `src/PostIt.Infrastructure/Authentication/JwtTokenService.cs:26-46`:

```csharp
var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secret));
var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

var claims = new[]
{
    new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),     // riga 33: "subject" = chi è
    new Claim(JwtRegisteredClaimNames.Email, user.Email),           // riga 34
    new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()) // riga 35: unico, per audit
};

var token = new JwtSecurityToken(
    issuer: _issuer,                 // "PostIt"
    audience: _audience,             // "PostIt"
    claims: claims,
    expires: DateTime.UtcNow.AddMinutes(15),    // 15 minuti di vita
    signingCredentials: credentials);
return new JwtSecurityTokenHandler().WriteToken(token);   // riga 45: serializza in stringa
```

L'utente è identificato dal claim `sub`. Per questo i controller lo rileggono con `User.FindFirst("sub")` (cap. 3.5).

### 8.4 Access token e refresh token

Due token con compiti diversi:

| | Access token | Refresh token |
|---|---|---|
| Valido | 15 minuti | 7 giorni |
| Forma | JWT firmato | stringa casuale di 32 byte (criptograficamente casuale) |
| Persistenza | stateless (viene validato con la firma) | **persistito** nel database |
| Uso | a ogni richiesta API | solo a `POST /api/auth/refresh` |

`GenerateRefreshToken` (`JwtTokenService.cs:48-54`) usa `RandomNumberGenerator` — non un `new Random()`, che sarebbe prevedibile. Non c'è firma: è un "segreto di sessione" che il server tiene in tabella `RefreshTokens`.

### 8.5 Il flusso di login (e il perché)

`POST /api/auth/login`:

1. **Verifica credenziali**: `AuthService.LoginAsync` (`AuthService.cs:57-80`) prende l'utente per email, confronta l'hash.
2. Emette `accessToken` (JWT, 15 min) e un `refreshToken` (casuale); salva quest'ultimo nel DB.
3. Risponde `LoginResponse` (`src/PostIt.Application/DTOs/LoginResponse.cs`): `{ accessToken, refreshToken, expiresAt }`.

La durata breve dell'access token è una scelta di sicurezza: se viene rubato, "muore" presto. Il refresh token in DB si può **revocare**.

### 8.6 La rotazione dei refresh token

Alla richiesta `POST /api/auth/refresh` (`AuthService.cs:82-111`):

```csharp
var refreshToken = await _refreshTokenRepository.GetByTokenAsync(request.RefreshToken, cancellationToken);
if (refreshToken == null || refreshToken.IsRevoked || refreshToken.ExpiresAt < DateTime.UtcNow)
    throw new InvalidOperationException("Invalid or expired refresh token.");   // righe 84-88

var user = await _userRepository.GetByIdAsync(refreshToken.UserId, cancellationToken);
...
// Rotate: revoke the old token
var newRefreshTokenValue = _tokenService.GenerateRefreshToken();
refreshToken.Revoke(newRefreshTokenValue);          // riga 98: il vecchio viene invalidato
await _refreshTokenRepository.UpdateAsync(refreshToken, cancellationToken);

var newRefreshToken = new RefreshToken(newRefreshTokenValue, user.Id, DateTime.UtcNow.AddDays(7));
await _refreshTokenRepository.AddAsync(newRefreshToken, cancellationToken);   // riga 106
```

La **rotazione** significa: a ogni uso, il vecchio refresh token viene revocato e ne viene emesso uno nuovo. Se un attaccante usa un token rubato, il legittimo proprietario che lo riusa trova il token già revocato → sospetto. L'entità `RefreshToken` ha anche `ReplacedByToken` proprio per tracciare questa catena (`RefreshToken.cs:10`).

### 8.7 Come il server valida il token ad ogni richiesta

La configurazione JWT in `Program.cs:71-110` dice al middleware di autenticazione come validare:

```csharp
options.TokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuerSigningKey = true,
    IssuerSigningKey = new SymmetricSecurityKey(key),
    ValidateIssuer = true, ValidIssuer = jwtSettings["Issuer"] ?? "PostIt",
    ValidateAudience = true, ValidAudience = jwtSettings["Audience"] ?? "PostIt",
    ValidateLifetime = true, ClockSkew = TimeSpan.Zero     // righe 85-95
};
```

Quando una richiesta protetta da `[Authorize]` arriva, il middleware:
1. legge l'header `Authorization: Bearer <token>`;
2. verifica firma, issuer, audience, scadenza;
3. se valido, **popola `User`** con i claims → le action leggono `User.FindFirst(...)` (cap. 3.5).

C'è anche un dettaglio per SignalR (`Program.cs:97-109`): i client in WebSocket non possono impostare header custom facilmente, quindi per le connessioni verso `/hubs` il token viene letto dalla **query string** `?access_token=...`. Da notare il controllo `path.StartsWithSegments("/hubs")`: non si apre questa fallback a tutte le route.

### 8.8 Le password non si salvano in chiaro

`PasswordHasher` (`src/PostIt.Infrastructure/Authentication/PasswordHasher.cs`) delega al `PasswordHasher<User>` di ASP.NET Core Identity: un algoritmo di hashing dedicato (PBKDF2, con **salt per utente**). Il progetto non reinventa nulla — come prescrive `PLAN.BE.md` §7: *"never implement custom password hashing"*.

- in salvataggio: `HashPassword(user, password)` → stringa che contiene salt+hash;
- in verifica: `VerifyHashedPassword(...)` restituisce `Success`/`Failure`. Nota che accetta anche `SuccessRehashNeeded` (riga 19): Identity può aggiornare l'hash col tempo senza rompere il login.

> 🧪 **ESERCIZIO 5** — Apri un token valido su [jwt.io](https://jwt.io) (login da Swagger, copia `accessToken`). Osserva il payload: vedi `sub`, `email`, `exp`... di cosa è fatta la firma? Ora cambia un carattere del token e re-invialo da Swagger: il middleware lo rifiuta (401). Ripeti il refresh del token (`POST /api/auth/refresh`) e controlla in database (col `RefreshTokens`): il vecchio è `IsRevoked = true`, con `ReplacedByToken` valorizzato.

---

## 9. DTO e mapping

### 9.1 Il problema

Le entità di dominio (`Note`, `Board`) hanno forme pensate per la logica interna, non per la rete. Esporre l'entità direttamente è rischioso:

- **evoluzione**: l'entità cambia forma (aggiungi un campo) → modifichi anche l'API che i client (React, Tauri, mobile) usano;
- **sovraesposizione**: l'entità può contenere campi che non vuoi far uscire (es. `PasswordHash`);
- **forma mirata**: posso esporre solo quello che serve al client in un formato stabile.

### 9.2 La soluzione in questo progetto

I **DTO** (*Data Transfer Object*) sono i "pacchetti" che attraversano l'API. Vivono in `src/PostIt.Application/DTOs/`, che ha tre "famiglie":

- **Request** (`RegisterRequest`, `LoginRequest`, `CreateNoteRequest`, `UpdateNoteRequest`, `CreateBoardRequest`, `UpdateBoardRequest`, `AddMemberRequest`, `UpdateMemberRequest`, `RefreshRequest`): ciò che il client invia;
- **Response** (`LoginResponse`, `MeResponse`): ciò che il server risponde all'utente;
- **Entity-DTO** (`NoteDto`, `BoardDto`, `BoardMemberDto`): forma "pubblica" di un'entità.

Esempio — `NoteDto.cs:15` (un `record`, vedi 9.4):

```csharp
public record NoteDto(Guid Id, Guid BoardId, Guid? CreatedBy, string Content,
                      string Color, int PositionX, int PositionY,
                      DateTime CreatedAt, DateTime UpdatedAt);
```

Come si assegna il ruolo? Gli attributi vanno **nell'Application layer**: solo login, tipi request/response e mapping vivono lì, mentre i controller (Api) si limitano a passare i DTO. I service si occupano della **conversione**:

### 9.3 Il mapping manuale nei service

`NoteService.MapToDto` (`NoteService.cs:141-153`):

```csharp
private static NoteDto MapToDto(Note note)
{
    return new NoteDto(
        note.Id, note.BoardId, note.CreatedBy,
        note.Content, note.Color,
        note.PositionX, note.PositionY,
        note.CreatedAt, note.UpdatedAt);
}
```

Pattern ricorrente nei service: la **lista** viene mappata con LINQ (`NoteService.cs:39-40`):

```csharp
var notes = await _noteRepository.GetNotesByBoardAsync(boardId, cancellationToken);
return notes.Select(MapToDto).ToList();   // riga 40: applica MapToDto a ogni elemento
```

In progetti più grandi si usa Automapper, ma qui il mapping manuale è **esplicito e leggibile** — poi anche più facile da mantenere per la grandezza del progetto.

### 9.4 Perché `record`?

I DTO usano la sintassi **`record`** (C# 9+). Convenienza pratica:
- immutabilità di default (non puoi cambiarli per errore);
- `==` per *valore* (due DTO "uguali nel contenuto" sono uguali anche se sono istanze diverse — utilissimo nei test, vedi cap. 13);
- **posizionale**: `new NoteDto(a, b, c)` come mostrato sopra, senza scrivere `{ get; init; }`.

Per un panorama completo: `Record` si usa quando lo scopo è il *contenitore di dati* (DTO, request). Le **entità** restano classi normali con comportamento (cap. 6.1).

> 🧪 **ESERCIZIO 6** — Apri `BoardDto.cs` e conta i campi rispetto a `Board.cs`: noterai che `Creator`, `Members` e `Notes` (i "collegamenti" alle altre entità) **non** appaiono in BoardDto. Perché? Perché la forma API espone **solo ciò che il client chiede**: i membri hanno già il proprio endpoint dedicato (`GET /api/boards/{id}/members`), ed esporre le relazioni in ogni risposta rischierebbe di restituire dati non necessari e risposte più "pesanti".

---

## 10. Real-time con SignalR

### 10.1 Il limite di HTTP

HTTP è *request/response*: un client può solo **chiedere e aspettare**. Ma PostIt deve notificare quando un altro utente modifica una nota: la UI del muro deve aggiornarsi **senza** che il client faccia polling continuo. Soluzione: una **connessione WebSocket** persistente con la libreria **SignalR**.

### 10.2 Il modello (Hub e gruppi)

SignalR funziona con **Hub**: classi C# che gestiscono le connessioni. Il pattern qui:

```
Client A (membro board 7)
   │  connessione WebSocket
   ▼
BoardHub (espose JoinBoard/LeaveBoard)
   │  A dice "aggiungimi al gruppo della board 7"
   ▼
Gruppo SignalR "7"
   ▲
   │ invio evento "PostItCreated { ... }"
   └────────→ a tutti i client del gruppo board 7
```

### 10.3 L'Hub del progetto

`src/PostIt.Api/Hubs/BoardHub.cs:7-18`:

```csharp
[Authorize]
public class BoardHub : Hub
{
    public async Task JoinBoard(Guid boardId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, boardId.ToString());
    }

    public async Task LeaveBoard(Guid boardId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, boardId.ToString());
    }
}
```

- `[Authorize]` (riga 6): si entra solo **autenticati** (il token arriva via query string, cap. 8.7);
- `Context.ConnectionId`: identifica la singola connessione;
- `Groups.AddToGroupAsync`: iscrive quella connessione al "canale" della board.
- L'Hub è registrato in `Program.cs:197` (`app.MapHub<BoardHub>("/hubs/board")`).

### 10.4 Mandare messaggi dal server: il "NotificationService"

Chi *invia* eventi non è l'Hub ma `BoardNotificationService` — `src/PostIt.Api/Services/BoardNotificationService.cs:17-21`:

```csharp
public async Task PostItCreated(Guid boardId, NoteDto note, CancellationToken cancellationToken = default)
{
    await _hubContext.Clients.Group(boardId.ToString())
        .SendAsync("PostItCreated", note, cancellationToken);
}
```

Punti chiave:

- `IHubContext<BoardHub>` è il modo "fuori dall'Hub" (da un service/controller) per mandare messaggi. È iniettato nel costruttore (riga 10-15);
- `Clients.Group(boardId.ToString())` → tutti i client nel gruppo;
- `SendAsync("PostItCreated", note, ...)` → evento con quel **nome** (il client React si iscrive con `connection.on("PostItCreated", ...)`) e quel **payload** (il DTO! proprio quello dell'API, così frontend riusa gli stessi modelli — vedi `PLAN.BE.md` §12).

### 10.5 E il timing? "Non broadcast prima della persistenza"

Il punto della sezione 10.5 è un'attività di design che il progetto rispetta: prima si **persistono** i dati, *poi* si invia l'evento. In `NoteService.CreateNoteAsync` (`NoteService.cs:59-66`):

```csharp
await _noteRepository.AddAsync(note, cancellationToken);
await _noteRepository.SaveChangesAsync(cancellationToken);   // riga 61: first persist!

var noteDto = MapToDto(note);
await _notificationService.PostItCreated(boardId, noteDto, cancellationToken);  // riga 64: then notify!
```

Se la persistenza fallisse (es. vincolo di database superato), l'eccezione risale e **nessun evento** viene inviato: i client non credono a una modifica che non esiste. Questo è il flusso esatto prescritto dal `PLAN.BE.md` §12.

> 🧪 **ESERCIZIO 7** — Nel cap. 13 trovi i test di integrazione SignalR. Strutturale: collega un client SignalR come "Viewer", crea una nota come "Editor" su un'altra connessione e verifica che l'evento `PostItCreated` arrivi solo al client del gruppo giusto.

---

## 11. Middleware custom

### 11.1 L'idea

Un **middleware** è un componente che sta nella pipeline (cap. 5.2). Ne avvolge un altro in un `try { await _next(context); }`. Il framework, per registrarlo, usa la classe `ExceptionHandlingMiddleware` → ultimo tappo, primo che vede l'eccezione.

La firma tipica — `src/PostIt.Api/Middleware/ExceptionHandlingMiddleware.cs:8-15`:

```csharp
public class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }
```

`RequestDelegate` è "il prossimo middleware". Il costruttore riceve il `next` **automaticamente** dal framework (e un `ILogger<T>` iniettato).

### 11.2 L'invocazione spiegata — passo passo

Il metodo `InvokeAsync` (`righe 17-31`):

```csharp
public async Task InvokeAsync(HttpContext context)
{
    try
    {
        await _next(context);          // riga 21: lascia passare la richiesta
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Unhandled exception occurred processing {Method} {Path}", ...);
        await HandleExceptionAsync(context, ex);   // riga 29
    }
}
```

- La richiesta "scende" con `await _next(context)` e "risale" con la risposta.
- Se **qualsiasi** middleware a valle lancia un'eccezione, il catch qui la intercetta.
- `HandleExceptionAsync` (righe 33-51) scrive una risposta `application/problem+json` con status `500`, e — solo se `IsDevelopment()` — il messaggio dell'eccezione (per un bugfix locale), altrimenti una frase generica. Questo protegge da **info leak** in produzione.

### 11.3 Perché esiste, quindi

Un'eccezione non gestita (dal database, da un `NullReferenceException`, da LINQ...) altrimenti risponderebbe con una pagina "500 Internal Server Error" del framework, inutile e magari piena di stack trace (in non-dev). Con questo middleware hai: logging strutturato, risposta uniforme, niente dettagli in prod.

> Confronta con il caso *previsto*: le eccezioni "logiche" (`KeyNotFoundException`, `UnauthorizedAccessException`, ecc.) NON arrivano qua — vengono catturate **dai controller** che le traducono in 404/403 (cap. 3.6). Questo middleware è la rete di sicurezza per l'**imprevisto**.

---

## 12. Errori e pattern di questo progetto

Estratto il "grande schema" di errori del progetto, perché è ciò che rende l'app prevedibile.

### 12.1 Le tre frecce dell'errore

```
Service                               Controller
───────────────                       ───────────────────────────────
throw KeyNotFoundException            → 500? no: return Problem(404)
throw UnauthorizedAccessException     → 403
throw ArgumentException               → 400
throw InvalidOperationException       → 409 (duplicati/conflitti) o 400
───────────────                       ───────────────────────────────
eccezione IMPREVISTA (altro)          → ExceptionHandlingMiddleware → 500
```

- I service lanciano **eccezioni standard di .NET** come "segnali" (non inventano tipi custom).
- I controller le catturano con `catch` **specifici** e le traducono nello status HTTP giusto.
- Quello che nessuno cattura finisce al middleware → `500`.

### 12.2 La nomenclatura dei messaggi

I messaggi delle eccezioni qui sono **scritti per l'utente finale** e spesso **ritornati al client** (es. `Problem(ex.Message, statusCode: ...)`). Nota le scelte:
- `"User with this email already exists."` (`AuthService.cs:30`);
- `"Board with id {boardId} not found."` (`BoardService.cs:43`);
- `"Only Owner or Editor can create notes."` (`NoteService.cs:50`);

È una scelta dibattuta in ambito pratico (messaggi tecnici vs messaggi di UX), ma qui sono coerenti e i test le verificano.

### 12.3 La validazione: dove e come

La validazione del business vive **nei service**, non nei controller. Es. `NoteService.ValidateContent/ValidateColor` (`NoteService.cs:115-139`):

```csharp
private static void ValidateContent(string content)
{
    if (string.IsNullOrWhiteSpace(content))
        throw new ArgumentException("Content is required.", nameof(content));
    if (content.Length > 1000)
        throw new ArgumentException("Content must not exceed 1000 characters.", nameof(content));
}
```

Perché qui? Perché una regola di business deve valere a **prescindere** dall'entry point (controller, SignalR, test). Nel controller, `ArgumentException` viene tradotta in `400` (`NotesController.cs:76-79`).

Dove sono invece vincoli **di trasporto** (es. "il campo deve esserci nel JSON") li gestisce la registrazione automatica di `[ApiController]` (cap. 3.1).

### 12.4 Riepilogo della gerarchia

```
1. Sistemi automatici del framework  → 400 di default (model binding, [ApiController])
2. Validazione business nei service  → ArgumentException → 400/409 nei controller
3. Autorizzazione nei service        → UnauthorizedAccessException → 403 nei controller
4. Risorse mancanti                  → KeyNotFoundException → 404 nei controller
5. Tutto il resto (imprevisti)       → ExceptionHandlingMiddleware → 500
```

Questa mappa serve a chiunque – incluso te in futuro – per aprire un controller e capire "cosa può rispondere questo endpoint" guardando solo i `catch` e i `[ProducesResponseType]`.

---

## 13. Testing

Il progetto ha **due suite** in `tests/`, come da `PLAN.BE.md` §16. Le idee chiave prima del codice:

- i **test unitari** provano una singola classe senza toccare il database;
- i **test di integrazione** avviano l'intera API con un database reale e fanno chiamate HTTP vere.

### 13.1 Unit test — come si isola una classe

`NoteServiceTests` (`tests/PostIt.UnitTests/Application/Services/NoteServiceTests.cs`) testa `NoteService` **senza** un database. Il segreto è una libreria chiamata **Moq** che crea **oggetti finti** di ogni interfaccia. Il costruttore (righe 11-20):

```csharp
private readonly Mock<INoteRepository> _noteRepo = new();
private readonly Mock<IBoardRepository> _boardRepo = new();
private readonly Mock<IBoardAuthorizationService> _authSvc = new();
private readonly Mock<IBoardNotificationService> _notificationSvc = new();
private readonly NoteService _svc;

public NoteServiceTests()
{
    _svc = new NoteService(_noteRepo.Object, _boardRepo.Object, _authSvc.Object, _notificationSvc.Object);
}
```

Ricorda: `NoteService` dipende da **interfacce** (cap. 6.2). Nei test sono `Mock<T>.Object`. Poi impostiamo cosa deve rispondere il mock e verifichiamo come si comporta il servizio — es. righe 44-53:

```csharp
_boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);          // "fingi che ci sia la board"
_authSvc.Setup(a => a.CanReadBoardAsync(userId, boardId, default)).ReturnsAsync(true); // "l'utente è membro"
_noteRepo.Setup(r => r.GetNotesByBoardAsync(boardId, default)).ReturnsAsync(...);      // "il repo restituisce 1 nota"

var result = await _svc.GetNotesAsync(userId, boardId);

Assert.Single(result);
Assert.Equal("Hello", result[0].Content);
```

I casi **d'errore** si testano allo stesso modo (righe 55-64):

```csharp
_boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync((Board?)null);
var ex = await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.GetNotesAsync(userId, boardId));
```

E in Moq a volte si usa `Callback` per **catturare** l'oggetto passato al repository e ispezionarlo (righe 88-103): il test verifica non solo la risposta ma anche *ciò che il servizio ha salvato*.

Nota (righe 62): `[Theory]` + `[InlineData(null)]` / `[InlineData("")]` eseguono lo stesso test con input diversi — è il modo compatto di testare la validazione (righe 128-136).

### 13.2 Test di integrazione — si avvia l'API vera

`TestWebApplicationFactory` (`tests/PostIt.IntegrationTests/TestWebApplicationFactory.cs`) è il ponte per "far partire il progetto":

- eredita da `WebApplicationFactory<Program>` — usa il `Program` reale dell'API (quello di `Program.cs:205`, che ha `public partial class Program` solo per essere referenciato nei test);
- **sostituisce** la configurazione (righe 19-29): connection string del test, segreto JWT di test, `DisableRateLimiting=true` (per non rallentare i test);
- **sostituisce il DbContext**: se trova l'indice del servizio, lo rimuove dal contenitore e lo ricrea con `SQLite` (fallback, quando Docker non c'è) o con **Testcontainers PostgreSQL** (se Docker è disponibile) — righe 40-55;
- `InitializeAsync` (righe 59-86) crea/migra il database.

I test d'integrazione poi parlano HTTP come un client esterno. `AuthEndpointsTests.cs:8-31`:

```csharp
public class AuthEndpointsTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly TestWebApplicationFactory _factory;
    private readonly HttpClient _client;

    public AuthEndpointsTests(TestWebApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();   // HttpClient già puntato all'API di test
    }

    [Fact]
    public async Task Register_ReturnsOk_WithTokens()
    {
        var request = new RegisterRequest("int-test@example.com", "Password123!", "Integration Test");
        var response = await _client.PostAsJsonAsync("/api/auth/register", request);   // vera chiamata HTTP

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<LoginResponse>();
        ...
    }
}
```

`IClassFixture<TestWebApplicationFactory>`: la factory viene creata **una volta** per classe di test e riusata. `PostAsJsonAsync`/`ReadFromJsonAsync` (da `System.Net.Http.Json`) serializzano/deserializzano i record DTO in automatico.

Per testare un endpoint protetto (righe 111-129) il test fa prima login e poi imposta l'header:

```csharp
_client.DefaultRequestHeaders.Authorization =
    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", registerResult.AccessToken);
```

### 13.3 Come eseguirli

```bash
cd apps/server
dotnet test                       # tutte le suite
dotnet test tests/PostIt.UnitTests
dotnet test tests/PostIt.IntegrationTests
```

Per i test di integrazione il codice prova dapprima a usare Docker + Testcontainers (PostgreSQL reale); se Docker non è disponibile, ripiega su un database SQLite di test (`EnsureCreated`). Non è necessaria un'infrastruttura speciale: basta che il DB di test sia raggiungibile.

> 🧪 **ESERCIZIO 8** — Apri `tests/PostIt.UnitTests/Infrastructure/Authentication/PasswordHasherTests.cs` e `JwtTokenServiceTests.cs`. Quali aspetti di sicurezza vengono provati (hash diverso per password uguali? token rifiutato se firmato male?)? Un'avvertenza pratica: parametriche "passa e verifica".

---

## 14. Configurazione, sicurezza e osservabilità

### 14.1 Le `appsettings`

I valori di configurazione vivono in JSON (`src/PostIt.Api/appsettings.json` e `appsettings.Development.json`) e vengono letti via `IConfiguration` in tutta l'app.

`appsettings.Development.json`:

```json
{
  "ConnectionStrings": { "DefaultConnection": "Host=localhost;Database=postit;..." },
  "JwtSettings": { "Secret": "your-super-secret...", "Issuer": "PostIt", "Audience": "PostIt" }
}
```

Come vengono letti:
- la **connection string** in `DependencyInjection.cs:20` (`configuration.GetConnectionString("DefaultConnection")`);
- il **segreto JWT** in 2 punti: `JwtTokenService.cs:20-24` (per firmare) e `Program.cs:81-83` (per verificare). Nota: il segreto deve combaciare tra generazione e verifica.

**Regole di sicurezza**:
- mai committare segreti reali: qui è un placeholder "your-super-secret..." (in produzione lo fornisci via variabili d'ambiente, che .NET sovrascrive su `appsettings`);
- il valore è riusato sia per firmare sia per verificare (chiave simmetrica HS256);
- `Program.cs:82` lancia se manca il segreto: fallimento esplicito piuttosto che token "non firmati" o ambigui.

### 14.2 Rate limiting — difesa da brute force

`Program.cs:119-132` definisce una policy "auth":

```csharp
options.AddPolicy("auth", context =>
{
    var ipAddress = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    return RateLimitPartition.GetFixedWindowLimiter(ipAddress, _ => new FixedWindowRateLimiterOptions
    {
        PermitLimit = 5, Window = TimeSpan.FromMinutes(1), ...
    });
});
```

- limite: **5 richieste al minuto** per indirizzo IP;
- applicata solo agli endpoint auth con l'attributo `[EnableRateLimiting("auth")]` — `AuthController.cs:12`;
- disattivabile negli ambienti di test via `DisableRateLimiting` (`Program.cs:172-175`).

### 14.3 CORS

`Program.cs:140-149`: la policy "LocalDevelopment" consente le origini `http://localhost:5173` e `http://localhost:3000` (frontend React), con qualsiasi header/metodo e credenziali. È l'elenco di "chi può chiamare questa API da browser".

### 14.4 Health check

`Program.cs:134-138` e `177-194`: `GET /health` verifica che (a) il processo viva e (b) **il database risponda** (`AddDbContextCheck<PostItDbContext>`). Il `ResponseWriter` custom (righe 179-193) serializza l'esito di ogni check in JSON — utile per orchestratori (Docker/K8s) che pingano `/health`.

### 14.5 Logging

`Program.cs:59-68`: logging su console e debug, con soglia `Information`. In sviluppo `AddHttpLogging` (righe 64-68) registra per ogni richiesta: proprietà header selezionate e status della risposta. Pratico per il debug locale: ogni chiamata di Swagger è tracciata.

---

## Appendice A: Glossario

| Termine | Spiegazione breve in questo contesto |
|---|---|
| Action | Metodo di un controller che gestisce un endpoint |
| `[ApiController]` | Attributo che abilita validazione automatica e binding |
| Model binding | Il processo con cui .NET riempie i parametri delle action da URL/body/query |
| `ActionResult<T>` | Tipo di ritorno che può contenere dati oppure un risultato HTTP |
| Problem Details | Formato JSON standard per errori (`title`, `status`, `detail`) |
| DI / Service | Registrazione e risoluzione automatica delle dipendenze nel contenitore |
| Scoped/Transient/Singleton | Lifetime di un servizio in DI (per richiesta / per richiesta / per processo) |
| Middleware | Componente della pipeline che "avvolge" la richiesta |
| Swagger / OpenAPI | Documentazione interattiva e contratto macchinario dell'API |
| ORM | Object-Relational Mapper: traduce oggetti ↔ righe di DB |
| DbContext | Classe EF Core: unit of work + query |
| Migration | Versione dello schema del database in codice C# |
| Fluent API | Configurazione delle entità EF con codice (`builder.HasKey`, `HasMaxLength`...) |
| Repository | Facciata di accesso dati con metodi semantici |
| Unit of work | Meccanismo per raggruppare modifiche e salvarle insieme |
| JWT | Token firmato con claims; access token stateless |
| Claim | Coppia chiave/valore firmata nel token (es. `sub` = id utente) |
| Refresh token | Token casuale persistito, revocabile, usato per rinnovare l'access token |
| Rotazione | Emissione di un nuovo token invalidando il precedente a ogni uso |
| DTO | Oggetto "pacco" che attraversa la rete, separato dalle entità |
| SignalR | Libreria per real-time (WebSocket) con Hub |
| Hub | Classe che gestisce connessioni e gruppi SignalR |
| `IHubContext<T>` | Modalità per inviare eventi ai client fuori dall'Hub |
| Clean Architecture | Organizzazione in layer con dipendenze interne di verso centro |
| Dependency rule | Le dipendenze puntano verso il dominio, mai inverse |
| Composition root | Il punto unico dove si assemblano interfacce e implementazioni |
| xUnit / Moq | framework di test / libreria di mock |
| `WebApplicationFactory<T>` | Classe per avviare l'app reale nei test di integrazione |
| Testcontainers | Avvio di DB reali (PostgreSQL) in container Docker per i test |

---

## Appendice B: Mappa completa dei file

>Tutti i percorsi sono relativi a `apps/server/`.

### Soluzione e configurazione
| File | Scopo |
|---|---|
| `PostIt.sln` | Solution .NET: raggruppa tutti i progetti |
| `src/PostIt.Api/Program.cs` | Costruzione del server: servizi, middleware, route |
| `src/PostIt.Api/appsettings.json` | Configurazione base (logging, allowed hosts) |
| `src/PostIt.Api/appsettings.Development.json` | Config di sviluppo: connection string, JwtSettings |

### PostIt.Api — livello web
| File | Scopo |
|---|---|
| `src/PostIt.Api/Controllers/AuthController.cs` | Endpoint auth: register, login, refresh, logout, me |
| `src/PostIt.Api/Controllers/BoardsController.cs` | Endpoint board + member management |
| `src/PostIt.Api/Controllers/NotesController.cs` | Endpoint CRUD note |
| `src/PostIt.Api/Hubs/BoardHub.cs` | Hub SignalR: JoinBoard/LeaveBoard |
| `src/PostIt.Api/Services/BoardNotificationService.cs` | Invio eventi SignalR dopo persistenza |
| `src/PostIt.Api/Middleware/ExceptionHandlingMiddleware.cs` | Catch globale eccezioni → Problem Details |
| `src/PostIt.Api/Migrations/*` | Migrazioni EF (schema DB versionato) |

### PostIt.Application — logica applicativa
| File | Scopo |
|---|---|
| `src/PostIt.Application/DependencyInjection.cs` | Registrazione DI dei service |
| `src/PostIt.Application/Services/AuthService.cs` | Logic register/login/refresh/logout |
| `src/PostIt.Application/Services/BoardService.cs` | CRUD board + crea Owner |
| `src/PostIt.Application/Services/BoardMemberService.cs` | Gestione membri e permessi |
| `src/PostIt.Application/Services/BoardAuthorizationService.cs` | Regole Owner/Editor/Viewer |
| `src/PostIt.Application/Services/NoteService.cs` | CRUD note + validazione + notifiche |
| `src/PostIt.Application/Interfaces/*` | Contratti (service, repository, hasher, token) |
| `src/PostIt.Application/DTOs/*` | Request/Response ed entity-DTO |

### PostIt.Domain — modellazione
| File | Scopo |
|---|---|
| `src/PostIt.Domain/Entities/User.cs` | Utente: email, password hash, displayName |
| `src/PostIt.Domain/Entities/Board.cs` | Board con membri e note |
| `src/PostIt.Domain/Entities/BoardMember.cs` | Membri con ruolo |
| `src/PostIt.Domain/Entities/Note.cs` | Nota (testo, colore, posizione) |
| `src/PostIt.Domain/Entities/RefreshToken.cs` | Token di sessione con revoca/rotazione |
| `src/PostIt.Domain/Enums/BoardRole.cs` | Ruoli: Owner, Editor, Viewer |

### PostIt.Infrastructure — implementazioni concrete
| File | Scopo |
|---|---|
| `src/PostIt.Infrastructure/DependencyInjection.cs` | Registrazione DI di DB, repo, auth |
| `src/PostIt.Infrastructure/Persistence/PostItDbContext.cs` | DbContext EF Core |
| `src/PostIt.Infrastructure/Persistence/Repositories/*` | Implementazioni repository (EF) |
| `src/PostIt.Infrastructure/Persistence/Configurations/*` | Configurazioni Fluent table/constraints/relationships |
| `src/PostIt.Infrastructure/Authentication/JwtTokenService.cs` | Generazione/validazione JWT |
| `src/PostIt.Infrastructure/Authentication/PasswordHasher.cs` | Hashing password (Identity) |

### Tests — appendice
| File | Scopo |
|---|---|
| `tests/PostIt.UnitTests/**` | Unit test (entity, service, auth) |
| `tests/PostIt.UnitTests/Application/Services/NoteServiceTests.cs` | Esempio completo con Moq |
| `tests/PostIt.IntegrationTests/TestWebApplicationFactory.cs` | La "fixture" che avvia l'app di test |
| `tests/PostIt.IntegrationTests/HealthEndpointTests.cs` | Test di health check |
| `tests/PostIt.IntegrationTests/AuthEndpointsTests.cs` | Test HTTP auth end-to-end |
| `tests/PostIt.IntegrationTests/BoardEndpointsTests.cs`, `BoardMemberEndpointsTests.cs`, `NoteEndpointsTests.cs` | Test CRUD board/membri/note |
| `tests/PostIt.IntegrationTests/DatabaseConnectivityTests.cs`, `Persistence/EntityPersistenceTests.cs` | Test del database |
| `tests/PostIt.IntegrationTests/SignalRTests.cs` | Test real-time |

### Altri
| File | Scopo |
|---|---|
| `PLAN.BE.md` (root) | Il piano tecnico da cui nasce il backend |

---

## Appendice C: Ordine di lettura consigliato

Se vuoi impiegare il documento in autonomia, questa è la sequenza che unisce costruzione reale e comprensione:

1. **I concetti nominali** (ca. 30 min): leggi §1 (mappa), §2 (viaggio richiesta). Ora hai il telaio.
2. **Program.cs, poi controller** (1-2h): §5 e §3 — sono i file con cui avrai più contatto all'apertura del progetto.
3. **DI** (§4): perché tutto si incastra. Rileggi `Program.cs` con occhi nuovi.
4. **EF Core e il DB** (§7) + service (§2.4): costruisci una piccola modifica (es. aggiungi un campo a Note) e segui il percorso end-to-end.
5. **Auth** (§8): il pezzo con più "mistero"; osserva il payload su jwt.io.
6. **SignalR** (§10): il più affascinante, anche perché dipende da tutto il resto.
7. Clean Architecture (§6) e gestione errori (§12) come "chiusura" per dare forma al quadro.
8. **Testing** (§13): una volta compreso il resto, i test diventano la tua miglior fonte di spiegazione "come deve comportarsi X".

Al termine, obiettivo verificabile: **modificare un endpoint esistente senza rompere i test**, e aggiungerne uno nuovo seguendo i pattern del progetto.

---

## Appendice D: Esercizi — suggerimenti

- **Esercizio 1 (breakpoint nel login)**: con un breakpoint a `AuthController.cs:29` ti fermerai anche nel service, nel repository e in EF Core quando la richiesta passa da loro. Aggiungi altri breakpoint in `PasswordHasher.HashPassword` e in `JwtTokenService.GenerateAccessToken` per vedere l'ordine in cui le dipendenze dell'`AuthService` vengono usate.
- **Esercizio 2 (DI)**: il *Call Stack* mostrerà un frame tipo `ServiceProviderServiceExtensions` + `ActivatorUtilities` — è DI che costruisce la catena. Ogni `AddScoped<IBoardRepository, BoardRepository>` risolve da contratti a concreti.
- **Esercizio 3 (Swagger)**: ricordati che gli endpoint "note" richiedono `Bearer <accessToken>` (ottenuto da register/login). Senza token → 401; con token → puoi creare board/note e osservare il flusso.
- **Esercizio 4 (limite colonna)**: se riduci `HasMaxLength` sotto 1000, il test d'integrazione che crea contenuti lunghi fallirà con errore DB (cfr. `EntityPersistenceTests`). È la dimostrazione che una colonna del DB implementa un vincolo applicativo.
- **Esercizio 5 (jwt.io)**: con un access token valido, il *verifier* deve usare la stessa `Secret` e gli stessi Issuer/Audience, altrimenti jwt.io segnala firma non valida. Cambiare un carattere ⇒ la firma risulta non valida ⇒ 401 dal middleware. Dopo `POST /api/auth/refresh`, in DB il vecchio token ha `IsRevoked=true` e `ReplacedByToken` aggiornato.
- **Esercizio 6 (BoardDto)**: `BoardDto` selettivo per non esporre `Creator/Members/Notes` — la lista membri ha già il proprio endpoint (`GET /api/boards/{id}/members`). Principio: *l'API espone solo ciò che il client chiede*.
- **Esercizio 7 (SignalR)**: nei test d'integrazione `SignalRTests.cs` trovi il pattern con `HubConnectionBuilder` per client reali. Crea 2 client: uno nel gruppo board, uno fuori; la modifica produce evento solo nel primo.
- **Esercizio 8 (password/token)**: nei test vedrai verifiche di *hashing divergente* (due hash diversi per la stessa password, grazie al salt), *token scaduto → rifiutato*, *firma alterata → rifiutato*... Sfida: in un test usa un segreto sbagliato nel `JwtTokenServiceTests` e osserva il fallimento della verifica della firma. Buon lavoro!

---
*E se vuoi continuare oltre questo documento: il modo migliore per fissare è modificare il codice. Scrivi una nuova entità (es. "Commenti") seguendo i pattern che vedi in `Note` e `Board`, con DTO, service, repository, controller, e un test per ognuno.*