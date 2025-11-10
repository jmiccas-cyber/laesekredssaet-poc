-- POC v2.8 – simplified SQL schema for Supabase later

CREATE TABLE Centralbibliotek (
    CentralbibliotekID SERIAL PRIMARY KEY,
    Navn TEXT NOT NULL,
    Region TEXT
);

CREATE TABLE Bibliotek (
    BibliotekID SERIAL PRIMARY KEY,
    Navn TEXT NOT NULL,
    TilhørerCentralbibliotekID INT REFERENCES Centralbibliotek(CentralbibliotekID),
    Aktiv BOOLEAN DEFAULT TRUE
);

CREATE TABLE Saet (
    SaetID SERIAL PRIMARY KEY,
    Titel TEXT,
    Forfatter TEXT,
    ISBN TEXT,
    FAUST TEXT,
    Antal INT,
    LaaneperiodeDage INT DEFAULT 60,
    Synlighed TEXT CHECK (Synlighed IN ('Landsdækkende','Regional')),
    CentralbibliotekID INT REFERENCES Centralbibliotek(CentralbibliotekID)
);

CREATE TABLE Beholdning (
    Stregkode TEXT PRIMARY KEY,
    ISBN TEXT,
    FAUST TEXT,
    Titel TEXT,
    Forfatter TEXT,
    Status TEXT CHECK (Status IN ('Ledig','Reserveret','Udlånt','Hjemkommet','Mangler')),
    Region TEXT,
    CentralbibliotekID INT REFERENCES Centralbibliotek(CentralbibliotekID)
);

CREATE TABLE Booking (
    BookingID SERIAL PRIMARY KEY,
    BibliotekID INT REFERENCES Bibliotek(BibliotekID),
    SaetID INT REFERENCES Saet(SaetID),
    StartDato DATE,
    SlutDato DATE,
    Status TEXT CHECK (Status IN ('Pending','Approved','Rejected'))
);

CREATE TABLE BookingEksemplar (
    BookingID INT REFERENCES Booking(BookingID),
    Stregkode TEXT REFERENCES Beholdning(Stregkode),
    PRIMARY KEY (BookingID, Stregkode)
);
