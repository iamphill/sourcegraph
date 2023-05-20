final: prev:
let
  inherit (import ./util.nix { inherit (prev) lib; }) makeStatic unNixifyDylibs;
  combyBuilder = comby: ocamlPkgs: systemDepsPkgs: (comby.override {
    sqlite = systemDepsPkgs.sqlite;
    zlib = systemDepsPkgs.zlib.static or systemDepsPkgs.zlib;
    libev = (makeStatic (systemDepsPkgs.libev)).override { static = false; };
    gmp = makeStatic systemDepsPkgs.gmp;
    ocamlPackages = ocamlPkgs.ocamlPackages.overrideScope' (self: super: {
      ocaml_pcre = super.ocaml_pcre.override {
        pcre = makeStatic systemDepsPkgs.pcre;
      };
      ssl = super.ssl.override {
        openssl = (makeStatic systemDepsPkgs.openssl).override { static = true; };
      };
    });
  }
  );
in
{
  comby =
    (if prev.hostPlatform.isMacOS then
      unNixifyDylibs prev.comby prev.pkgs (combyBuilder prev.pkgs prev.pkgsStatic)
    else
      (combyBuilder prev.pkgsMusl.comby prev.pkgsMusl prev.pkgsStatic).overrideAttrs (_: {
        postPatch = ''
          cat >> src/dune <<EOF
          (env (release (flags  :standard -ccopt -static)))
          EOF
        '';
      }));
}
