<script lang="ts">
  import { type FileKind, fileKind } from './fileKind.js';
  import { cn } from './utils.js';
  import ada from 'material-icon-theme/icons/ada.svg?raw';
  import arduino from 'material-icon-theme/icons/arduino.svg?raw';
  import assembly from 'material-icon-theme/icons/assembly.svg?raw';
  import astro from 'material-icon-theme/icons/astro.svg?raw';
  import audio from 'material-icon-theme/icons/audio.svg?raw';
  import bicep from 'material-icon-theme/icons/bicep.svg?raw';
  import bun from 'material-icon-theme/icons/bun.svg?raw';
  import bunLight from 'material-icon-theme/icons/bun_light.svg?raw';
  import c from 'material-icon-theme/icons/c.svg?raw';
  import cairo from 'material-icon-theme/icons/cairo.svg?raw';
  import certificate from 'material-icon-theme/icons/certificate.svg?raw';
  import clojure from 'material-icon-theme/icons/clojure.svg?raw';
  import cmake from 'material-icon-theme/icons/cmake.svg?raw';
  import cobol from 'material-icon-theme/icons/cobol.svg?raw';
  import coffee from 'material-icon-theme/icons/coffee.svg?raw';
  import console from 'material-icon-theme/icons/console.svg?raw';
  import cpp from 'material-icon-theme/icons/cpp.svg?raw';
  import crystal from 'material-icon-theme/icons/crystal.svg?raw';
  import crystalLight from 'material-icon-theme/icons/crystal_light.svg?raw';
  import csharp from 'material-icon-theme/icons/csharp.svg?raw';
  import css from 'material-icon-theme/icons/css.svg?raw';
  import cuda from 'material-icon-theme/icons/cuda.svg?raw';
  import d from 'material-icon-theme/icons/d.svg?raw';
  import dart from 'material-icon-theme/icons/dart.svg?raw';
  import database from 'material-icon-theme/icons/database.svg?raw';
  import diff from 'material-icon-theme/icons/diff.svg?raw';
  import docker from 'material-icon-theme/icons/docker.svg?raw';
  import document from 'material-icon-theme/icons/document.svg?raw';
  import editorconfig from 'material-icon-theme/icons/editorconfig.svg?raw';
  import elixir from 'material-icon-theme/icons/elixir.svg?raw';
  import elm from 'material-icon-theme/icons/elm.svg?raw';
  import erlang from 'material-icon-theme/icons/erlang.svg?raw';
  import file from 'material-icon-theme/icons/file.svg?raw';
  import font from 'material-icon-theme/icons/font.svg?raw';
  import fortran from 'material-icon-theme/icons/fortran.svg?raw';
  import fsharp from 'material-icon-theme/icons/fsharp.svg?raw';
  import gemfile from 'material-icon-theme/icons/gemfile.svg?raw';
  import git from 'material-icon-theme/icons/git.svg?raw';
  import gleam from 'material-icon-theme/icons/gleam.svg?raw';
  import go from 'material-icon-theme/icons/go.svg?raw';
  import goMod from 'material-icon-theme/icons/go-mod.svg?raw';
  import godot from 'material-icon-theme/icons/godot.svg?raw';
  import graphql from 'material-icon-theme/icons/graphql.svg?raw';
  import groovy from 'material-icon-theme/icons/groovy.svg?raw';
  import gradle from 'material-icon-theme/icons/gradle.svg?raw';
  import h from 'material-icon-theme/icons/h.svg?raw';
  import hack from 'material-icon-theme/icons/hack.svg?raw';
  import haskell from 'material-icon-theme/icons/haskell.svg?raw';
  import haxe from 'material-icon-theme/icons/haxe.svg?raw';
  import hcl from 'material-icon-theme/icons/hcl.svg?raw';
  import hclLight from 'material-icon-theme/icons/hcl_light.svg?raw';
  import hpp from 'material-icon-theme/icons/hpp.svg?raw';
  import html from 'material-icon-theme/icons/html.svg?raw';
  import idris from 'material-icon-theme/icons/idris.svg?raw';
  import image from 'material-icon-theme/icons/image.svg?raw';
  import java from 'material-icon-theme/icons/java.svg?raw';
  import javascript from 'material-icon-theme/icons/javascript.svg?raw';
  import json from 'material-icon-theme/icons/json.svg?raw';
  import julia from 'material-icon-theme/icons/julia.svg?raw';
  import jupyter from 'material-icon-theme/icons/jupyter.svg?raw';
  import key from 'material-icon-theme/icons/key.svg?raw';
  import kotlin from 'material-icon-theme/icons/kotlin.svg?raw';
  import lean from 'material-icon-theme/icons/lean.svg?raw';
  import less from 'material-icon-theme/icons/less.svg?raw';
  import license from 'material-icon-theme/icons/license.svg?raw';
  import lisp from 'material-icon-theme/icons/lisp.svg?raw';
  import lock from 'material-icon-theme/icons/lock.svg?raw';
  import log from 'material-icon-theme/icons/log.svg?raw';
  import lua from 'material-icon-theme/icons/lua.svg?raw';
  import luau from 'material-icon-theme/icons/luau.svg?raw';
  import makefile from 'material-icon-theme/icons/makefile.svg?raw';
  import markdown from 'material-icon-theme/icons/markdown.svg?raw';
  import mdx from 'material-icon-theme/icons/mdx.svg?raw';
  import mojo from 'material-icon-theme/icons/mojo.svg?raw';
  import nginx from 'material-icon-theme/icons/nginx.svg?raw';
  import nim from 'material-icon-theme/icons/nim.svg?raw';
  import nix from 'material-icon-theme/icons/nix.svg?raw';
  import nodejs from 'material-icon-theme/icons/nodejs.svg?raw';
  import npm from 'material-icon-theme/icons/npm.svg?raw';
  import objectiveC from 'material-icon-theme/icons/objective-c.svg?raw';
  import objectiveCpp from 'material-icon-theme/icons/objective-cpp.svg?raw';
  import ocaml from 'material-icon-theme/icons/ocaml.svg?raw';
  import odin from 'material-icon-theme/icons/odin.svg?raw';
  import pascal from 'material-icon-theme/icons/pascal.svg?raw';
  import pdf from 'material-icon-theme/icons/pdf.svg?raw';
  import perl from 'material-icon-theme/icons/perl.svg?raw';
  import php from 'material-icon-theme/icons/php.svg?raw';
  import pnpm from 'material-icon-theme/icons/pnpm.svg?raw';
  import powershell from 'material-icon-theme/icons/powershell.svg?raw';
  import prisma from 'material-icon-theme/icons/prisma.svg?raw';
  import prolog from 'material-icon-theme/icons/prolog.svg?raw';
  import proto from 'material-icon-theme/icons/proto.svg?raw';
  import purescript from 'material-icon-theme/icons/purescript.svg?raw';
  import python from 'material-icon-theme/icons/python.svg?raw';
  import r from 'material-icon-theme/icons/r.svg?raw';
  import racket from 'material-icon-theme/icons/racket.svg?raw';
  import react from 'material-icon-theme/icons/react.svg?raw';
  import reactTs from 'material-icon-theme/icons/react_ts.svg?raw';
  import readme from 'material-icon-theme/icons/readme.svg?raw';
  import reason from 'material-icon-theme/icons/reason.svg?raw';
  import rescript from 'material-icon-theme/icons/rescript.svg?raw';
  import ruby from 'material-icon-theme/icons/ruby.svg?raw';
  import rust from 'material-icon-theme/icons/rust.svg?raw';
  import sass from 'material-icon-theme/icons/sass.svg?raw';
  import scala from 'material-icon-theme/icons/scala.svg?raw';
  import scheme from 'material-icon-theme/icons/scheme.svg?raw';
  import settings from 'material-icon-theme/icons/settings.svg?raw';
  import shader from 'material-icon-theme/icons/shader.svg?raw';
  import solidity from 'material-icon-theme/icons/solidity.svg?raw';
  import stylus from 'material-icon-theme/icons/stylus.svg?raw';
  import svelte from 'material-icon-theme/icons/svelte.svg?raw';
  import svg from 'material-icon-theme/icons/svg.svg?raw';
  import swift from 'material-icon-theme/icons/swift.svg?raw';
  import table from 'material-icon-theme/icons/table.svg?raw';
  import tcl from 'material-icon-theme/icons/tcl.svg?raw';
  import terraform from 'material-icon-theme/icons/terraform.svg?raw';
  import testJs from 'material-icon-theme/icons/test-js.svg?raw';
  import testJsx from 'material-icon-theme/icons/test-jsx.svg?raw';
  import testTs from 'material-icon-theme/icons/test-ts.svg?raw';
  import tex from 'material-icon-theme/icons/tex.svg?raw';
  import toml from 'material-icon-theme/icons/toml.svg?raw';
  import tomlLight from 'material-icon-theme/icons/toml_light.svg?raw';
  import tsconfig from 'material-icon-theme/icons/tsconfig.svg?raw';
  import tune from 'material-icon-theme/icons/tune.svg?raw';
  import typescript from 'material-icon-theme/icons/typescript.svg?raw';
  import typescriptDef from 'material-icon-theme/icons/typescript-def.svg?raw';
  import vala from 'material-icon-theme/icons/vala.svg?raw';
  import verilog from 'material-icon-theme/icons/verilog.svg?raw';
  import video from 'material-icon-theme/icons/video.svg?raw';
  import vim from 'material-icon-theme/icons/vim.svg?raw';
  import visualstudio from 'material-icon-theme/icons/visualstudio.svg?raw';
  import vlang from 'material-icon-theme/icons/vlang.svg?raw';
  import vue from 'material-icon-theme/icons/vue.svg?raw';
  import webassembly from 'material-icon-theme/icons/webassembly.svg?raw';
  import xaml from 'material-icon-theme/icons/xaml.svg?raw';
  import xml from 'material-icon-theme/icons/xml.svg?raw';
  import yaml from 'material-icon-theme/icons/yaml.svg?raw';
  import yarn from 'material-icon-theme/icons/yarn.svg?raw';
  import zig from 'material-icon-theme/icons/zig.svg?raw';
  import zip from 'material-icon-theme/icons/zip.svg?raw';

  const ICONS: Record<FileKind, string | readonly [dark: string, light: string]> = {
    ada,
    arduino,
    assembly,
    astro,
    audio,
    bicep,
    bun: [bun, bunLight],
    c,
    cairo,
    certificate,
    clojure,
    cmake,
    cobol,
    coffee,
    console,
    cpp,
    crystal: [crystal, crystalLight],
    csharp,
    css,
    cuda,
    d,
    dart,
    database,
    diff,
    docker,
    document,
    editorconfig,
    elixir,
    elm,
    erlang,
    file,
    font,
    fortran,
    fsharp,
    gemfile,
    git,
    gleam,
    go,
    'go-mod': goMod,
    godot,
    graphql,
    groovy,
    gradle,
    h,
    hack,
    haskell,
    haxe,
    hcl: [hcl, hclLight],
    hpp,
    html,
    idris,
    image,
    java,
    javascript,
    json,
    julia,
    jupyter,
    key,
    kotlin,
    lean,
    less,
    license,
    lisp,
    lock,
    log,
    lua,
    luau,
    makefile,
    markdown,
    mdx,
    mojo,
    nginx,
    nim,
    nix,
    nodejs,
    npm,
    'objective-c': objectiveC,
    'objective-cpp': objectiveCpp,
    ocaml,
    odin,
    pascal,
    pdf,
    perl,
    php,
    pnpm,
    powershell,
    prisma,
    prolog,
    proto,
    purescript,
    python,
    r,
    racket,
    react,
    react_ts: reactTs,
    readme,
    reason,
    rescript,
    ruby,
    rust,
    sass,
    scala,
    scheme,
    settings,
    shader,
    solidity,
    stylus,
    svelte,
    svg,
    swift,
    table,
    tcl,
    terraform,
    'test-js': testJs,
    'test-jsx': testJsx,
    'test-ts': testTs,
    tex,
    toml: [toml, tomlLight],
    tsconfig,
    tune,
    typescript,
    'typescript-def': typescriptDef,
    vala,
    verilog,
    video,
    vim,
    visualstudio,
    vlang,
    vue,
    webassembly,
    xaml,
    xml,
    yaml,
    yarn,
    zig,
    zip,
  };

  let { path, class: extra }: { path: string; class?: string } = $props();

  const kind = $derived(fileKind(path));
  const icon = $derived(ICONS[kind]);
</script>

<span class={cn('file-icon inline-flex size-3.5 shrink-0', extra)} aria-hidden="true" data-file-kind={kind}>
  {#if typeof icon === 'string'}
    {@html icon}
  {:else}
    <span class="on-dark">{@html icon[0]}</span>
    <span class="on-light">{@html icon[1]}</span>
  {/if}
</span>

<style>
  .file-icon :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .on-dark {
    display: none;
  }
  .on-light {
    display: contents;
  }
  :global(.dark) .on-dark {
    display: contents;
  }
  :global(.dark) .on-light {
    display: none;
  }
</style>
