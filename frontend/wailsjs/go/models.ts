export namespace dokument {
	
	export class AnmerkungHinzugefuegt {
	    client_id: string;
	    ref: string;
	    nm: string;
	
	    static createFrom(source: any = {}) {
	        return new AnmerkungHinzugefuegt(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.client_id = source["client_id"];
	        this.ref = source["ref"];
	        this.nm = source["nm"];
	    }
	}
	export class Anmerkungsstatus {
	    ref: string;
	    page?: number;
	    state: string;
	
	    static createFrom(source: any = {}) {
	        return new Anmerkungsstatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ref = source["ref"];
	        this.page = source["page"];
	        this.state = source["state"];
	    }
	}
	export class Anmerkungsverweis {
	    ref: string;
	    page?: number;
	
	    static createFrom(source: any = {}) {
	        return new Anmerkungsverweis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ref = source["ref"];
	        this.page = source["page"];
	    }
	}
	export class Anmerkungstext {
	    ref: string;
	    page?: number;
	    contents: string;
	
	    static createFrom(source: any = {}) {
	        return new Anmerkungstext(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ref = source["ref"];
	        this.page = source["page"];
	        this.contents = source["contents"];
	    }
	}
	export class Stempel {
	    label: string;
	    name: string;
	    signed: boolean;
	    lang: string;
	
	    static createFrom(source: any = {}) {
	        return new Stempel(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.name = source["name"];
	        this.signed = source["signed"];
	        this.lang = source["lang"];
	    }
	}
	export class NeueAnmerkung {
	    client_id: string;
	    page: number;
	    kind: string;
	    rect: number[];
	    quads: number[][];
	    paths: number[][];
	    line: number[];
	    contents: string;
	    color: number[];
	    width: number;
	    font_size: number;
	    reply_to: string;
	    stamp?: Stempel;
	    uri?: string;
	    page_target?: number;
	
	    static createFrom(source: any = {}) {
	        return new NeueAnmerkung(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.client_id = source["client_id"];
	        this.page = source["page"];
	        this.kind = source["kind"];
	        this.rect = source["rect"];
	        this.quads = source["quads"];
	        this.paths = source["paths"];
	        this.line = source["line"];
	        this.contents = source["contents"];
	        this.color = source["color"];
	        this.width = source["width"];
	        this.font_size = source["font_size"];
	        this.reply_to = source["reply_to"];
	        this.stamp = this.convertValues(source["stamp"], Stempel);
	        this.uri = source["uri"];
	        this.page_target = source["page_target"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Anmerkungsbefehle {
	    add: NeueAnmerkung[];
	    update: Anmerkungstext[];
	    delete: Anmerkungsverweis[];
	    state: Anmerkungsstatus[];
	
	    static createFrom(source: any = {}) {
	        return new Anmerkungsbefehle(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.add = this.convertValues(source["add"], NeueAnmerkung);
	        this.update = this.convertValues(source["update"], Anmerkungstext);
	        this.delete = this.convertValues(source["delete"], Anmerkungsverweis);
	        this.state = this.convertValues(source["state"], Anmerkungsstatus);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Anmerkungsergebnis {
	    added: AnmerkungHinzugefuegt[];
	
	    static createFrom(source: any = {}) {
	        return new Anmerkungsergebnis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.added = this.convertValues(source["added"], AnmerkungHinzugefuegt);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class Bericht {
	    pages: number;
	    kept_annotations: number;
	    dropped_annotations: number;
	    annotations_removed_with_pages: number;
	    annotations_added: number;
	    annotations_removed: number;
	    annotations_kept_foreign: number;
	    form_fields_before: number;
	    form_fields_after: number;
	    form_fields_removed_with_pages: number;
	    attachments_before: number;
	    attachments_after: number;
	    attachments_removed_with_pages: number;
	    bookmarks_before: number;
	    bookmarks_after: number;
	    bookmarks_removed_with_pages: number;
	    warnings: string[];
	    losses: string[];
	
	    static createFrom(source: any = {}) {
	        return new Bericht(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pages = source["pages"];
	        this.kept_annotations = source["kept_annotations"];
	        this.dropped_annotations = source["dropped_annotations"];
	        this.annotations_removed_with_pages = source["annotations_removed_with_pages"];
	        this.annotations_added = source["annotations_added"];
	        this.annotations_removed = source["annotations_removed"];
	        this.annotations_kept_foreign = source["annotations_kept_foreign"];
	        this.form_fields_before = source["form_fields_before"];
	        this.form_fields_after = source["form_fields_after"];
	        this.form_fields_removed_with_pages = source["form_fields_removed_with_pages"];
	        this.attachments_before = source["attachments_before"];
	        this.attachments_after = source["attachments_after"];
	        this.attachments_removed_with_pages = source["attachments_removed_with_pages"];
	        this.bookmarks_before = source["bookmarks_before"];
	        this.bookmarks_after = source["bookmarks_after"];
	        this.bookmarks_removed_with_pages = source["bookmarks_removed_with_pages"];
	        this.warnings = source["warnings"];
	        this.losses = source["losses"];
	    }
	}
	export class Eigenschaften {
	    title?: string;
	    subject?: string;
	    author?: string;
	    keywords?: string;
	
	    static createFrom(source: any = {}) {
	        return new Eigenschaften(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.subject = source["subject"];
	        this.author = source["author"];
	        this.keywords = source["keywords"];
	    }
	}
	export class Inspektion {
	    pages: number;
	    pdf_version: string;
	    encrypted: boolean;
	    user_password: boolean;
	    signed: boolean;
	    forms: boolean;
	    form_fields: number;
	    xfa: boolean;
	    attachments: number;
	    bookmarks: number;
	    annotations: number;
	    links: number;
	    widgets: number;
	    javascript: boolean;
	    pdfa: boolean;
	    tagged: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Inspektion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pages = source["pages"];
	        this.pdf_version = source["pdf_version"];
	        this.encrypted = source["encrypted"];
	        this.user_password = source["user_password"];
	        this.signed = source["signed"];
	        this.forms = source["forms"];
	        this.form_fields = source["form_fields"];
	        this.xfa = source["xfa"];
	        this.attachments = source["attachments"];
	        this.bookmarks = source["bookmarks"];
	        this.annotations = source["annotations"];
	        this.links = source["links"];
	        this.widgets = source["widgets"];
	        this.javascript = source["javascript"];
	        this.pdfa = source["pdfa"];
	        this.tagged = source["tagged"];
	    }
	}
	export class Leerseite {
	    width: number;
	    height: number;
	
	    static createFrom(source: any = {}) {
	        return new Leerseite(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.width = source["width"];
	        this.height = source["height"];
	    }
	}
	
	export class Seite {
	    source: number;
	    rotate: number;
	    blank?: Leerseite;
	
	    static createFrom(source: any = {}) {
	        return new Seite(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.source = source["source"];
	        this.rotate = source["rotate"];
	        this.blank = this.convertValues(source["blank"], Leerseite);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace export {
	
	export class Zelle {
	    text: string;
	    source?: string;
	    confidence: number;
	    bbox: number[];
	
	    static createFrom(source: any = {}) {
	        return new Zelle(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.text = source["text"];
	        this.source = source["source"];
	        this.confidence = source["confidence"];
	        this.bbox = source["bbox"];
	    }
	}
	export class Tabelle {
	    index: number;
	    pages: number[];
	    cols: number;
	    header_rows: number;
	    column_types: string[];
	    rows: Zelle[][];
	
	    static createFrom(source: any = {}) {
	        return new Tabelle(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.index = source["index"];
	        this.pages = source["pages"];
	        this.cols = source["cols"];
	        this.header_rows = source["header_rows"];
	        this.column_types = source["column_types"];
	        this.rows = this.convertValues(source["rows"], Zelle);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Block {
	    type: string;
	    level?: number;
	    lines?: string[];
	    text?: string;
	    font_size?: number;
	    source?: string;
	    uncertain?: boolean;
	    header_footer?: boolean;
	    repeated?: boolean;
	    bbox: number[];
	    table?: Tabelle;
	
	    static createFrom(source: any = {}) {
	        return new Block(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.level = source["level"];
	        this.lines = source["lines"];
	        this.text = source["text"];
	        this.font_size = source["font_size"];
	        this.source = source["source"];
	        this.uncertain = source["uncertain"];
	        this.header_footer = source["header_footer"];
	        this.repeated = source["repeated"];
	        this.bbox = source["bbox"];
	        this.table = this.convertValues(source["table"], Tabelle);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Seite {
	    page: number;
	    width: number;
	    height: number;
	    source: string;
	    image_ratio: number;
	    continues_table: boolean;
	    blocks: Block[];
	
	    static createFrom(source: any = {}) {
	        return new Seite(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.source = source["source"];
	        this.image_ratio = source["image_ratio"];
	        this.continues_table = source["continues_table"];
	        this.blocks = this.convertValues(source["blocks"], Block);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Warnung {
	    code: string;
	    count?: number;
	    pages?: number[];
	    detail?: string;
	
	    static createFrom(source: any = {}) {
	        return new Warnung(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.count = source["count"];
	        this.pages = source["pages"];
	        this.detail = source["detail"];
	    }
	}
	export class Quelle {
	    sha256: string;
	    pages: number[];
	
	    static createFrom(source: any = {}) {
	        return new Quelle(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sha256 = source["sha256"];
	        this.pages = source["pages"];
	    }
	}
	export class Dokument {
	    heuristics_version: number;
	    source: Quelle;
	    warnings: Warnung[];
	    pages: Seite[];
	
	    static createFrom(source: any = {}) {
	        return new Dokument(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.heuristics_version = source["heuristics_version"];
	        this.source = this.convertValues(source["source"], Quelle);
	        this.warnings = this.convertValues(source["warnings"], Warnung);
	        this.pages = this.convertValues(source["pages"], Seite);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class Tabellenwahl {
	    index: number;
	    include: boolean;
	    header_rows: number;
	    column_types: string[];
	
	    static createFrom(source: any = {}) {
	        return new Tabellenwahl(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.index = source["index"];
	        this.include = source["include"];
	        this.header_rows = source["header_rows"];
	        this.column_types = source["column_types"];
	    }
	}
	

}

export namespace main {
	
	export class AuftragErgebnis {
	    size: number;
	    sha256: string;
	    meta: number[];
	
	    static createFrom(source: any = {}) {
	        return new AuftragErgebnis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.size = source["size"];
	        this.sha256 = source["sha256"];
	        this.meta = source["meta"];
	    }
	}
	export class AuftragFehler {
	    code: string;
	
	    static createFrom(source: any = {}) {
	        return new AuftragFehler(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	    }
	}
	export class Fortschritt {
	    done: number;
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new Fortschritt(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.done = source["done"];
	        this.total = source["total"];
	    }
	}
	export class AuftragOptionen {
	    pages: number[];
	    languages: string;
	
	    static createFrom(source: any = {}) {
	        return new AuftragOptionen(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pages = source["pages"];
	        this.languages = source["languages"];
	    }
	}
	export class Auftrag {
	    id: string;
	    file_id: string;
	    kind: string;
	    state: string;
	    base_version: number;
	    base_sha256: string;
	    options: AuftragOptionen;
	    progress: Fortschritt;
	    error?: AuftragFehler;
	    result?: AuftragErgebnis;
	    // Go type: time
	    created_at: any;
	    // Go type: time
	    finished_at?: any;
	    // Go type: time
	    expires_at?: any;
	    render_pages: number[];
	    dpi: number;
	
	    static createFrom(source: any = {}) {
	        return new Auftrag(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.file_id = source["file_id"];
	        this.kind = source["kind"];
	        this.state = source["state"];
	        this.base_version = source["base_version"];
	        this.base_sha256 = source["base_sha256"];
	        this.options = this.convertValues(source["options"], AuftragOptionen);
	        this.progress = this.convertValues(source["progress"], Fortschritt);
	        this.error = this.convertValues(source["error"], AuftragFehler);
	        this.result = this.convertValues(source["result"], AuftragErgebnis);
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.finished_at = this.convertValues(source["finished_at"], null);
	        this.expires_at = this.convertValues(source["expires_at"], null);
	        this.render_pages = source["render_pages"];
	        this.dpi = source["dpi"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AuftragOptionenRumpf {
	    pages?: number[];
	    languages: string;
	
	    static createFrom(source: any = {}) {
	        return new AuftragOptionenRumpf(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pages = source["pages"];
	        this.languages = source["languages"];
	    }
	}
	export class AuftragBefehl {
	    kind: string;
	    expected_version: number;
	    options: AuftragOptionenRumpf;
	    owner_password: string;
	
	    static createFrom(source: any = {}) {
	        return new AuftragBefehl(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.expected_version = source["expected_version"];
	        this.options = this.convertValues(source["options"], AuftragOptionenRumpf);
	        this.owner_password = source["owner_password"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Ziel {
	    kind?: string;
	    drive_id: string;
	    folder_id?: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new Ziel(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.drive_id = source["drive_id"];
	        this.folder_id = source["folder_id"];
	        this.name = source["name"];
	    }
	}
	export class AuftragCommit {
	    destination: Ziel;
	    comment: string;
	    accept_losses: string[];
	
	    static createFrom(source: any = {}) {
	        return new AuftragCommit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.destination = this.convertValues(source["destination"], Ziel);
	        this.comment = source["comment"];
	        this.accept_losses = source["accept_losses"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	export class BindeQuelle {
	    file_id: string;
	    expected_version: number;
	    pages: number[];
	
	    static createFrom(source: any = {}) {
	        return new BindeQuelle(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file_id = source["file_id"];
	        this.expected_version = source["expected_version"];
	        this.pages = source["pages"];
	    }
	}
	export class BindeBefehl {
	    sources: BindeQuelle[];
	    destination: Ziel;
	    bookmarks_per_source: boolean;
	    accept_losses: string[];
	
	    static createFrom(source: any = {}) {
	        return new BindeBefehl(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sources = this.convertValues(source["sources"], BindeQuelle);
	        this.destination = this.convertValues(source["destination"], Ziel);
	        this.bookmarks_per_source = source["bookmarks_per_source"];
	        this.accept_losses = source["accept_losses"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class CommitBefehl {
	    expected_version: number;
	    expected_sha256: string;
	    pages?: dokument.Seite[];
	    annotations?: dokument.Anmerkungsbefehle;
	    properties?: dokument.Eigenschaften;
	    password: string;
	    owner_password: string;
	    destination: Ziel;
	    comment: string;
	    accept_losses: string[];
	
	    static createFrom(source: any = {}) {
	        return new CommitBefehl(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.expected_version = source["expected_version"];
	        this.expected_sha256 = source["expected_sha256"];
	        this.pages = this.convertValues(source["pages"], dokument.Seite);
	        this.annotations = this.convertValues(source["annotations"], dokument.Anmerkungsbefehle);
	        this.properties = this.convertValues(source["properties"], dokument.Eigenschaften);
	        this.password = source["password"];
	        this.owner_password = source["owner_password"];
	        this.destination = this.convertValues(source["destination"], Ziel);
	        this.comment = source["comment"];
	        this.accept_losses = source["accept_losses"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DateiWahl {
	    id: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new DateiWahl(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class DruckBefehl {
	    pages: number[];
	    annotations?: boolean;
	    expected_version: number;
	    password: string;
	    owner_password: string;
	
	    static createFrom(source: any = {}) {
	        return new DruckBefehl(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pages = source["pages"];
	        this.annotations = source["annotations"];
	        this.expected_version = source["expected_version"];
	        this.password = source["password"];
	        this.owner_password = source["owner_password"];
	    }
	}
	export class Ergebnis {
	    file_id: string;
	    name: string;
	    version: number;
	    sha256: string;
	    report: dokument.Bericht;
	    annotations?: dokument.Anmerkungsergebnis;
	
	    static createFrom(source: any = {}) {
	        return new Ergebnis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file_id = source["file_id"];
	        this.name = source["name"];
	        this.version = source["version"];
	        this.sha256 = source["sha256"];
	        this.report = this.convertValues(source["report"], dokument.Bericht);
	        this.annotations = this.convertValues(source["annotations"], dokument.Anmerkungsergebnis);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ExportCSV {
	    delimiter: string;
	    table: number;
	
	    static createFrom(source: any = {}) {
	        return new ExportCSV(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.delimiter = source["delimiter"];
	        this.table = source["table"];
	    }
	}
	export class ExportBefehl {
	    format: string;
	    tables: export.Tabellenwahl[];
	    number_locale: string;
	    csv: ExportCSV;
	    destination: Ziel;
	
	    static createFrom(source: any = {}) {
	        return new ExportBefehl(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.format = source["format"];
	        this.tables = this.convertValues(source["tables"], export.Tabellenwahl);
	        this.number_locale = source["number_locale"];
	        this.csv = this.convertValues(source["csv"], ExportCSV);
	        this.destination = this.convertValues(source["destination"], Ziel);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ExportErgebnis {
	    file_id: string;
	    name: string;
	    size: number;
	    sha256: string;
	    warnings: export.Warnung[];
	
	    static createFrom(source: any = {}) {
	        return new ExportErgebnis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file_id = source["file_id"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.sha256 = source["sha256"];
	        this.warnings = this.convertValues(source["warnings"], export.Warnung);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ExtraktBefehl {
	    pages: number[];
	    mode: string;
	    destination: Ziel;
	    expected_version: number;
	    accept_losses: string[];
	
	    static createFrom(source: any = {}) {
	        return new ExtraktBefehl(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pages = source["pages"];
	        this.mode = source["mode"];
	        this.destination = this.convertValues(source["destination"], Ziel);
	        this.expected_version = source["expected_version"];
	        this.accept_losses = source["accept_losses"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ExtraktErgebnis {
	    files: Ergebnis[];
	
	    static createFrom(source: any = {}) {
	        return new ExtraktErgebnis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = this.convertValues(source["files"], Ergebnis);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Faehigkeit {
	    state: string;
	    reason?: string;
	
	    static createFrom(source: any = {}) {
	        return new Faehigkeit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.state = source["state"];
	        this.reason = source["reason"];
	    }
	}
	export class Faehigkeiten {
	    pages: Faehigkeit;
	    extract: Faehigkeit;
	    merge: Faehigkeit;
	    annotations: Faehigkeit;
	    ocr: Faehigkeit;
	    export: Faehigkeit;
	
	    static createFrom(source: any = {}) {
	        return new Faehigkeiten(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pages = this.convertValues(source["pages"], Faehigkeit);
	        this.extract = this.convertValues(source["extract"], Faehigkeit);
	        this.merge = this.convertValues(source["merge"], Faehigkeit);
	        this.annotations = this.convertValues(source["annotations"], Faehigkeit);
	        this.ocr = this.convertValues(source["ocr"], Faehigkeit);
	        this.export = this.convertValues(source["export"], Faehigkeit);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Geoeffnet {
	    id: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new Geoeffnet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class Info {
	    file_id: string;
	    name: string;
	    version: number;
	    sha256: string;
	    size: number;
	    access: string;
	    inspection: dokument.Inspektion;
	    capabilities: Faehigkeiten;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file_id = source["file_id"];
	        this.name = source["name"];
	        this.version = source["version"];
	        this.sha256 = source["sha256"];
	        this.size = source["size"];
	        this.access = source["access"];
	        this.inspection = this.convertValues(source["inspection"], dokument.Inspektion);
	        this.capabilities = this.convertValues(source["capabilities"], Faehigkeiten);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LizenzTeil {
	    gruppe: string;
	    name: string;
	    fassung: string;
	    lizenz: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new LizenzTeil(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.gruppe = source["gruppe"];
	        this.name = source["name"];
	        this.fassung = source["fassung"];
	        this.lizenz = source["lizenz"];
	        this.text = source["text"];
	    }
	}
	export class Lizenzauskunft {
	    app: string;
	    urheber: string;
	    lizenz: string;
	    text: string;
	    teile: LizenzTeil[];
	
	    static createFrom(source: any = {}) {
	        return new Lizenzauskunft(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.app = source["app"];
	        this.urheber = source["urheber"];
	        this.lizenz = source["lizenz"];
	        this.text = source["text"];
	        this.teile = this.convertValues(source["teile"], LizenzTeil);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Seitenart {
	    page: number;
	    kind: string;
	    chars: number;
	    image_ratio: number;
	
	    static createFrom(source: any = {}) {
	        return new Seitenart(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.kind = source["kind"];
	        this.chars = source["chars"];
	        this.image_ratio = source["image_ratio"];
	    }
	}
	export class Seitenarten {
	    version: number;
	    pages: Seitenart[];
	
	    static createFrom(source: any = {}) {
	        return new Seitenarten(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.pages = this.convertValues(source["pages"], Seitenart);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ZuletztEintrag {
	    schluessel: string;
	    name: string;
	    ordner: string;
	    fehlt: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ZuletztEintrag(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schluessel = source["schluessel"];
	        this.name = source["name"];
	        this.ordner = source["ordner"];
	        this.fehlt = source["fehlt"];
	    }
	}
	export class StartInfo {
	    person: string;
	    ocr: string;
	    ocr_fehler?: string;
	    zuletzt: ZuletztEintrag[];
	    geoeffnet?: Geoeffnet;
	    schnelldruck: boolean;
	    fassung: string;
	    bau: string;
	    urheber: string;
	
	    static createFrom(source: any = {}) {
	        return new StartInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.person = source["person"];
	        this.ocr = source["ocr"];
	        this.ocr_fehler = source["ocr_fehler"];
	        this.zuletzt = this.convertValues(source["zuletzt"], ZuletztEintrag);
	        this.geoeffnet = this.convertValues(source["geoeffnet"], Geoeffnet);
	        this.schnelldruck = source["schnelldruck"];
	        this.fassung = source["fassung"];
	        this.bau = source["bau"];
	        this.urheber = source["urheber"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ZielAnfrage {
	    zweck: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new ZielAnfrage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.zweck = source["zweck"];
	        this.name = source["name"];
	    }
	}

}

